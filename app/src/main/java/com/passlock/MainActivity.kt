package com.passlock

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.passlock.crypto.BiometricKeyManager
import com.passlock.data.VaultRepository
import com.passlock.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var repo: VaultRepository
    private lateinit var bioManager: BiometricKeyManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        repo = VaultRepository(this)
        bioManager = BiometricKeyManager(this)

        if (!repo.vaultExists()) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

        setupUI()
    }

    override fun onResume() {
        super.onResume()
        // If vault key was cleared by auto-lock, ensure we are on auth screen
        val app = application as PasslockApp
        if (app.vaultKey != null) {
            goToVault()
            return
        }
        // Auto-trigger biometric if available
        if (bioManager.isAvailable() && repo.getBiometricWrappedKey() != null) {
            triggerBiometric()
        } else {
            binding.passwordSection.visibility = View.VISIBLE
        }
    }

    private fun setupUI() {
        val hasBio = bioManager.isAvailable() && repo.getBiometricWrappedKey() != null
        binding.btnFingerprint.visibility = if (hasBio) View.VISIBLE else View.GONE
        binding.tvOrDivider.visibility = if (hasBio) View.VISIBLE else View.GONE

        binding.btnFingerprint.setOnClickListener { triggerBiometric() }

        binding.btnUnlock.setOnClickListener {
            val pw = binding.etPassword.text.toString()
            if (pw.isBlank()) {
                binding.tilPassword.error = "Enter your master password"
                return@setOnClickListener
            }
            binding.tilPassword.error = null
            unlockWithPassword(pw)
        }

        binding.etPassword.setOnEditorActionListener { _, _, _ ->
            binding.btnUnlock.performClick(); true
        }
    }

    private fun triggerBiometric() {
        val wrapped = repo.getBiometricWrappedKey() ?: return
        try {
            val iv = android.util.Base64.decode(wrapped.iv, android.util.Base64.NO_WRAP)
            val cipher = bioManager.decryptCipher(iv)
            bioManager.authenticate(
                activity = this,
                title = "Unlock Passlock",
                subtitle = "Touch sensor to unlock your vault",
                cipher = cipher,
                onSuccess = { decCipher ->
                    val key = bioManager.decryptWithCipher(decCipher, wrapped)
                    (application as PasslockApp).vaultKey = key
                    goToVault()
                },
                onFallback = {
                    binding.passwordSection.visibility = View.VISIBLE
                    binding.etPassword.requestFocus()
                },
                onError = { msg ->
                    Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
                    binding.passwordSection.visibility = View.VISIBLE
                }
            )
        } catch (e: Exception) {
            Toast.makeText(this, "Biometric key changed — please use password", Toast.LENGTH_LONG).show()
            binding.passwordSection.visibility = View.VISIBLE
        }
    }

    private fun unlockWithPassword(password: String) {
        binding.progressBar.visibility = View.VISIBLE
        binding.btnUnlock.isEnabled = false

        Thread {
            val key = repo.unlockWithPassword(password)
            runOnUiThread {
                binding.progressBar.visibility = View.GONE
                binding.btnUnlock.isEnabled = true
                if (key != null) {
                    (application as PasslockApp).vaultKey = key
                    goToVault()
                } else {
                    binding.tilPassword.error = "Incorrect password"
                }
            }
        }.start()
    }

    private fun goToVault() {
        startActivity(Intent(this, VaultActivity::class.java))
        finish()
    }
}
