package com.openfinance.app;

import com.getcapacitor.BridgeActivity;
import com.openfinance.plugin.KeystorePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(KeystorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
