package com.openfinance.app;

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
}
