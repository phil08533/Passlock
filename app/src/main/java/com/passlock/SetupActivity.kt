package com.passlock

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.passlock.crypto.BiometricKeyManager
import com.passlock.data.VaultRepository
import com.passlock.databinding.ActivitySetupBinding

class SetupActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySetupBinding
    private lateinit var repo: VaultRepository
    private lateinit var bioManager: BiometricKeyManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySetupBinding.inflate(layoutInflater)
        setContentView(binding.root)

        repo = VaultRepository(this)
        bioManager = BiometricKeyManager(this)

        if (!bioManager.isAvailable()) {
            binding.switchBiometric.isEnabled = false
            binding.switchBiometric.text = "Fingerprint not available on this device"
        }

        binding.btnCreate.setOnClickListener { attemptCreate() }
    }

    private fun attemptCreate() {
        val pw = binding.etPassword.text.toString()
        val confirm = binding.etConfirm.text.toString()

        binding.tilPassword.error = null
        binding.tilConfirm.error = null

        if (pw.length < 8) {
            binding.tilPassword.error = "Password must be at least 8 characters"
            return
        }
        if (pw != confirm) {
            binding.tilConfirm.error = "Passwords do not match"
            return
        }

        binding.btnCreate.isEnabled = false
        binding.progressBar.visibility = android.view.View.VISIBLE

        val enableBio = binding.switchBiometric.isChecked && bioManager.isAvailable()

        Thread {
            val vaultKey = repo.createVault(pw)
            (application as PasslockApp).vaultKey = vaultKey

            if (enableBio) {
                try {
                    bioManager.generateKey()
                    val cipher = bioManager.encryptCipher()
                    runOnUiThread {
                        binding.progressBar.visibility = android.view.View.GONE
                        bioManager.authenticate(
                            activity = this,
                            title = "Register Fingerprint",
                            subtitle = "Authenticate to enable fingerprint unlock",
                            cipher = cipher,
                            onSuccess = { encCipher ->
                                val wrapped = bioManager.encryptWithCipher(encCipher, vaultKey)
                                repo.storeBiometricWrappedKey(wrapped)
                                goToVault()
                            },
                            onFallback = { goToVault() },
                            onError = { goToVault() }
                        )
                    }
                } catch (e: Exception) {
                    runOnUiThread { goToVault() }
                }
            } else {
                runOnUiThread {
                    binding.progressBar.visibility = android.view.View.GONE
                    goToVault()
                }
            }
        }.start()
    }

    private fun goToVault() {
        Toast.makeText(this, "Vault created!", Toast.LENGTH_SHORT).show()
        startActivity(Intent(this, VaultActivity::class.java))
        finish()
    }
}
