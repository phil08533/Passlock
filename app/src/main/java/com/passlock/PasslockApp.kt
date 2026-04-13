package com.passlock

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import javax.crypto.SecretKey

class PasslockApp : Application() {

    /** Vault key held in memory only while app is unlocked. */
    var vaultKey: SecretKey? = null

    private var backgroundedAt: Long = 0L
    private val AUTO_LOCK_MS = 60_000L // 1 minute

    override fun onCreate() {
        super.onCreate()

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                backgroundedAt = System.currentTimeMillis()
            }
            override fun onStart(owner: LifecycleOwner) {
                if (backgroundedAt > 0 &&
                    System.currentTimeMillis() - backgroundedAt > AUTO_LOCK_MS) {
                    vaultKey = null
                }
                backgroundedAt = 0L
            }
        })
    }

    fun lock() {
        vaultKey = null
    }
}
