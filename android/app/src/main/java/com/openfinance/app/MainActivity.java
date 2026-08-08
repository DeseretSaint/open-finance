package com.openfinance.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.openfinance.plugin.KeystorePlugin;
import com.openfinance.plugin.PlaidProxyPlugin;
import com.openfinance.plugin.RemoteServerPlugin;
import com.openfinance.plugin.UpdaterPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(KeystorePlugin.class);
        registerPlugin(PlaidProxyPlugin.class);
        registerPlugin(RemoteServerPlugin.class);
        registerPlugin(UpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // Keep the WebView's JS event loop alive when the app is backgrounded but
    // direct remote access is enabled. Capacitor's BridgeActivity.onPause()
    // calls bridge.onPause(), which freezes the JS renderer — so inbound agent
    // requests through the RemoteServerService foreground socket get answered
    // by a frozen renderer and 503 ("bridge is asleep"). With the renderer kept
    // awake (plus the foreground service + wake lock + RENDERER_PRIORITY_IMPORTANT
    // set in RemoteServerPlugin) the agent can reach the phone even when the app
    // is not on screen. We only skip the pause when remote access is live, so
    // normal backgrounding/Doze still pauses the renderer for battery.
    @Override
    public void onPause() {
        if (RemoteServerService.isRunning()) {
            super.onPause();
            // NB: deliberately do NOT call bridge.onPause() here.
        } else {
            super.onPause();
            if (bridge != null) bridge.onPause();
        }
    }
}
