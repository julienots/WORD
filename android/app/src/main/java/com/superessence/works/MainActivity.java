package com.superessence.works;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.speech.tts.TextToSpeech;
import android.view.WindowManager;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;

/**
 * .WORKS — SuperEssence Studio.
 * Adds "Open with .WORKS" support: a .docx opened/shared from another app (Files, Gmail, Drive,
 * WhatsApp…) is read here and handed untouched to the web editor through a JS interface.
 * Also exposes native printing / "Save as PDF" (Android print framework) and text-to-speech.
 */
public class MainActivity extends BridgeActivity {

    private volatile String pendingFile = null;
    private TextToSpeech tts;
    private boolean ttsReady = false;

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

    @Override
    public void onDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.onDestroy();
    }

    private void notifyJs(String event) {
        runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(
                "window.dispatchEvent(new Event('" + event + "'))", null));
    }

    private class NativeBridge {
        /** Returns {"name","data"(base64)} once, or null when nothing is pending. */
        @JavascriptInterface
        public String takePendingFile() {
            String f = pendingFile;
            pendingFile = null;
            return f;
        }

        /** Opens the Android print dialog for the current page (offers "Save as PDF"). */
        @JavascriptInterface
        public void print(String jobName) {
            runOnUiThread(() -> {
                try {
                    PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                    String name = (jobName == null || jobName.isEmpty()) ? ".WORKS" : jobName;
                    PrintDocumentAdapter adapter = getBridge().getWebView().createPrintDocumentAdapter(name);
                    PrintAttributes attrs = new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build();
                    pm.print(name, adapter, attrs);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });
        }

        /** Reads text aloud with the system text-to-speech engine. */
        @JavascriptInterface
        public void speak(String text, String lang) {
            runOnUiThread(() -> {
                Runnable say = () -> {
                    try {
                        tts.setLanguage(Locale.forLanguageTag(lang == null || lang.isEmpty() ? "fr-FR" : lang));
                    } catch (Exception ignored) {
                    }
                    // TTS has a max input length: queue the text in chunks.
                    int max = Math.max(500, TextToSpeech.getMaxSpeechInputLength() - 100);
                    tts.stop();
                    for (int i = 0; i < text.length(); i += max) {
                        String part = text.substring(i, Math.min(text.length(), i + max));
                        tts.speak(part, TextToSpeech.QUEUE_ADD, null, "works-" + i);
                    }
                };
                if (tts != null && ttsReady) {
                    say.run();
                    return;
                }
                tts = new TextToSpeech(MainActivity.this, status -> {
                    ttsReady = status == TextToSpeech.SUCCESS;
                    if (ttsReady) {
                        tts.setOnUtteranceProgressListener(new android.speech.tts.UtteranceProgressListener() {
                            @Override public void onStart(String id) { }
                            @Override public void onError(String id) { notifyJs("dotworks-tts-end"); }
                            @Override public void onDone(String id) {
                                if (!tts.isSpeaking()) notifyJs("dotworks-tts-end");
                            }
                        });
                        say.run();
                    } else {
                        notifyJs("dotworks-tts-end");
                    }
                });
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> {
                if (tts != null) tts.stop();
            });
        }

        @JavascriptInterface
        public boolean isSpeaking() {
            return tts != null && tts.isSpeaking();
        }

        /** Keep the screen on while editing (optional setting). */
        @JavascriptInterface
        public void keepScreenOn(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }
}
