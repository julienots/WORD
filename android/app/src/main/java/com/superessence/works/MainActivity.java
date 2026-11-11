package com.superessence.works;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * .WORKS — SuperEssence Studio.
 *
 * Native bridge for the web editor (window.DotWorksNative):
 *  - "Open with .WORKS": a .docx opened/shared from another app is handed untouched to the editor;
 *  - openDocument(): system picker (ACTION_OPEN_DOCUMENT) with persistent read/write access;
 *  - writeFile(uri, base64): "Enregistrer" overwrites the file that was opened, in place;
 *  - createDocument(name, base64): "Enregistrer sous…" (ACTION_CREATE_DOCUMENT: Downloads, Drive…).
 */
public class MainActivity extends BridgeActivity {

    private static final String DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    private static final String[] WORD_TYPES = {
            DOCX,
            "application/vnd.ms-word.document.macroEnabled.12",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
            "application/octet-stream",
            "application/zip"
    };

    private volatile String pendingFile = null;
    private volatile byte[] pendingSave = null;
    private ActivityResultLauncher<Intent> openLauncher;
    private ActivityResultLauncher<Intent> createLauncher;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), this::onOpenResult);
        createLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), this::onCreateResult);
        WebView webView = getBridge().getWebView();
        webView.addJavascriptInterface(new NativeBridge(), "DotWorksNative");
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        String action = intent.getAction();
        boolean writable = false;
        if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_EDIT.equals(action)) {
            uri = intent.getData();
            writable = (intent.getFlags() & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0
                    || "file".equals(uri == null ? null : uri.getScheme());
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null) return;
        loadFile(uri, writable);
        // Do not re-open the same file on configuration changes.
        intent.setAction(Intent.ACTION_MAIN);
    }

    /** Reads the file in the background and notifies the web app ('dotworks-file'). */
    private void loadFile(final Uri target, final boolean writable) {
        new Thread(() -> {
            try {
                String name = displayName(target);
                byte[] bytes = readAll(target);
                JSONObject json = new JSONObject();
                json.put("name", name);
                json.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                json.put("uri", target.toString());
                json.put("writable", writable && supportsWrite(target));
                pendingFile = json.toString();
                runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new Event('dotworks-file'))", null));
            } catch (Exception e) {
                e.printStackTrace();
                notifyJs("dotworks-error", "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}");
            }
        }).start();
    }

    private void onOpenResult(ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) return;
        Uri uri = result.getData().getData();
        boolean writable = takePermission(uri, result.getData().getFlags());
        loadFile(uri, writable);
    }

    private void onCreateResult(ActivityResult result) {
        final byte[] bytes = pendingSave;
        pendingSave = null;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null || bytes == null) {
            notifyJs("dotworks-saved", "{\"ok\":false,\"error\":\"cancelled\"}");
            return;
        }
        final Uri uri = result.getData().getData();
        takePermission(uri, result.getData().getFlags());
        new Thread(() -> {
            String res = write(uri, bytes);
            try {
                JSONObject json = new JSONObject();
                json.put("ok", "ok".equals(res));
                json.put("uri", uri.toString());
                json.put("name", displayName(uri));
                if (!"ok".equals(res)) json.put("error", res);
                notifyJs("dotworks-saved", json.toString());
            } catch (Exception e) {
                notifyJs("dotworks-saved", "{\"ok\":false,\"error\":\"json\"}");
            }
        }).start();
    }

    /** Keeps read/write access across restarts when the provider allows it. Returns true when writable. */
    private boolean takePermission(Uri uri, int flags) {
        boolean canWrite = (flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0;
        try {
            int keep = flags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if (keep != 0) getContentResolver().takePersistableUriPermission(uri, keep);
        } catch (Exception ignored) {
            // Not persistable (e.g. a simple VIEW intent): access lasts while the app runs.
        }
        return canWrite && supportsWrite(uri);
    }

    /** False when the document provider says the file is read-only. */
    private boolean supportsWrite(Uri uri) {
        if (!ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) return true;
        try {
            if (!DocumentsContract.isDocumentUri(this, uri)) return true;
            try (Cursor c = getContentResolver().query(uri, new String[]{DocumentsContract.Document.COLUMN_FLAGS}, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int f = c.getInt(0);
                    return (f & DocumentsContract.Document.FLAG_SUPPORTS_WRITE) != 0;
                }
            }
        } catch (Exception ignored) {
        }
        return true;
    }

    /** Overwrites the file. "wt" truncates, "rwt" is the fallback some providers (Drive…) need. */
    private String write(Uri uri, byte[] bytes) {
        String[] modes = {"wt", "rwt", "w"};
        String last = "write failed";
        for (String mode : modes) {
            try (OutputStream out = getContentResolver().openOutputStream(uri, mode)) {
                if (out == null) continue;
                out.write(bytes);
                out.flush();
                return "ok";
            } catch (Exception e) {
                last = String.valueOf(e.getMessage());
            }
        }
        return last;
    }

    private void notifyJs(String event, String json) {
        runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('" + event + "', { detail: " + json + " }))", null));
    }

    private String displayName(Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception ignored) {
            }
        }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "Document.docx";
        if (!name.toLowerCase().matches(".*\\.(docx|docm|dotx)$")) name = name + ".docx";
        return name;
    }

    private byte[] readAll(Uri uri) throws Exception {
        try (InputStream in = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IllegalStateException("cannot open " + uri);
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private class NativeBridge {
        /** Returns {"name","data"(base64),"uri","writable"} once, or null when nothing is pending. */
        @JavascriptInterface
        public String takePendingFile() {
            String f = pendingFile;
            pendingFile = null;
            return f;
        }

        /** Overwrites a previously opened file in place. Returns "ok" or an error message. */
        @JavascriptInterface
        public String writeFile(String uri, String base64) {
            try {
                return write(Uri.parse(uri), Base64.decode(base64, Base64.DEFAULT));
            } catch (Exception e) {
                return String.valueOf(e.getMessage());
            }
        }

        /** System picker to open a Word file with read/write access. Result arrives as 'dotworks-file'. */
        @JavascriptInterface
        public void openDocument() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, WORD_TYPES);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                openLauncher.launch(i);
            });
        }

        /** "Enregistrer sous…": the user chooses folder + name. Result arrives as 'dotworks-saved'. */
        @JavascriptInterface
        public void createDocument(String name, String base64) {
            pendingSave = Base64.decode(base64, Base64.DEFAULT);
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(DOCX);
                i.putExtra(Intent.EXTRA_TITLE, name);
                createLauncher.launch(i);
            });
        }
    }
}
