package uz.daho.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.ArrayList;
import java.util.List;

/**
 * Daho — asosiy oyna.
 *
 * Capacitor WebView ichida ishlaydigan sahifa (va uning ichidagi qumbox
 * ilovalari) kamera, mikrofon va joylashuv soʻraganda Android ikki bosqichli
 * ruxsat talab qiladi:
 *   1) ilovaning oʻzida tizim ruxsati boʻlishi kerak (runtime permission);
 *   2) WebView ning soʻrovini (PermissionRequest) qondirish kerak.
 * Standart holda ikkinchi bosqich rad etiladi va sahifada
 * «Permission denied» chiqadi. Shu yerda ikkalasini ham hal qilamiz.
 */
public class MainActivity extends BridgeActivity {

    private static final int WEB_PERMISSION_CODE = 9731;

    /** Tizim ruxsati kutilayotgan WebView soʻrovi. */
    private PermissionRequest pendingRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;

        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin,
                GeolocationPermissions.Callback callback
            ) {
                boolean allowed = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                    || hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION);
                if (!allowed) {
                    ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[] {
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        },
                        WEB_PERMISSION_CODE
                    );
                }
                callback.invoke(origin, true, false);
            }
        });
    }

    private boolean hasPermission(String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }

    /** WebView soʻragan resurslar uchun kerakli tizim ruxsatlari. */
    private List<String> missingFor(PermissionRequest request) {
        List<String> needed = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                && !hasPermission(Manifest.permission.CAMERA)) {
                needed.add(Manifest.permission.CAMERA);
            }
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                && !hasPermission(Manifest.permission.RECORD_AUDIO)) {
                needed.add(Manifest.permission.RECORD_AUDIO);
            }
        }
        return needed;
    }

    private void handleWebPermission(PermissionRequest request) {
        List<String> missing = missingFor(request);

        if (missing.isEmpty() || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            grant(request);
            return;
        }

        // Avval tizimdan soʻraymiz, javob kelgach WebView soʻrovini qondiramiz.
        pendingRequest = request;
        ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), WEB_PERMISSION_CODE);
    }

    private void grant(PermissionRequest request) {
        try {
            request.grant(request.getResources());
        } catch (Exception ignored) {
            request.deny();
        }
    }

    @Override
    public void onRequestPermissionsResult(
        int requestCode,
        String[] permissions,
        int[] grantResults
    ) {
        if (requestCode == WEB_PERMISSION_CODE) {
            PermissionRequest request = pendingRequest;
            pendingRequest = null;
            if (request != null) {
                boolean allGranted = grantResults.length > 0;
                for (int result : grantResults) {
                    if (result != PackageManager.PERMISSION_GRANTED) allGranted = false;
                }
                if (allGranted) grant(request);
                else request.deny();
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }
}
