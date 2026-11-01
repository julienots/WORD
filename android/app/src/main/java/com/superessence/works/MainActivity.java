package com.superessence.works;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * .WORKS — SuperEssence Studio.
 * Adds "Open with .WORKS" support: a .docx opened/shared from another app (Files, Gmail, Drive,
 * WhatsApp…) is read here and handed untouched to the web editor through a JS interface.
 */
public class MainActivity extends BridgeActivity {

    private volatile String pendingFile = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
        if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_EDIT.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null) return;
        final Uri target = uri;
        new Thread(() -> {
            try {
                String name = displayName(target);
                byte[] bytes = readAll(target);
                JSONObject json = new JSONObject();
                json.put("name", name);
                json.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                pendingFile = json.toString();
                runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new Event('dotworks-file'))", null));
            } catch (Exception e) {
                e.printStackTrace();
            }
        }).start();
        // Do not re-open the same file on configuration changes.
        intent.setAction(Intent.ACTION_MAIN);
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
        /** Returns {"name","data"(base64)} once, or null when nothing is pending. */
        @JavascriptInterface
        public String takePendingFile() {
            String f = pendingFile;
            pendingFile = null;
            return f;
        }
    }
}
