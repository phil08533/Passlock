package com.passlock

import android.os.Bundle
import android.view.MenuItem
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.passlock.crypto.BiometricKeyManager
import com.passlock.data.VaultRepository
import com.passlock.databinding.ActivitySettingsBinding

class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private lateinit var repo: VaultRepository
    private lateinit var bioManager: BiometricKeyManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        supportActionBar?.title = "Settings"

        repo = VaultRepository(this)
        bioManager = BiometricKeyManager(this)

        refreshUI()

        binding.btnChangePassword.setOnClickListener { showChangePasswordDialog() }
        binding.btnToggleBiometric.setOnClickListener { toggleBiometric() }
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == android.R.id.home) { finish(); return true }
        return super.onOptionsItemSelected(item)
    }

    private fun refreshUI() {
        val bioEnabled = repo.getBiometricWrappedKey() != null
        val bioAvailable = bioManager.isAvailable()

        if (!bioAvailable) {
            binding.bioSection.visibility = View.GONE
        } else {
            binding.bioSection.visibility = View.VISIBLE
            binding.tvBioStatus.text = if (bioEnabled) "Fingerprint unlock: ON" else "Fingerprint unlock: OFF"
            binding.btnToggleBiometric.text = if (bioEnabled) "Disable Fingerprint" else "Enable Fingerprint"
        }
    }

    private fun showChangePasswordDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_change_password, null)
        val etCurrent = dialogView.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.etCurrentPassword)
        val etNew = dialogView.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.etNewPassword)
        val etConfirm = dialogView.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.etConfirmPassword)

        AlertDialog.Builder(this)
            .setTitle("Change Master Password")
            .setView(dialogView)
            .setPositiveButton("Change") { _, _ ->
                val current = etCurrent.text.toString()
                val new = etNew.text.toString()
                val confirm = etConfirm.text.toString()

                if (new.length < 8) {
                    Toast.makeText(this, "New password must be at least 8 characters", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                if (new != confirm) {
                    Toast.makeText(this, "New passwords do not match", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                binding.progressBar.visibility = View.VISIBLE
                Thread {
                    val testKey = repo.unlockWithPassword(current)
                    runOnUiThread {
                        binding.progressBar.visibility = View.GONE
                        if (testKey == null) {
                            Toast.makeText(this, "Current password is incorrect", Toast.LENGTH_SHORT).show()
                        } else {
                            val vaultKey = (application as PasslockApp).vaultKey ?: testKey
                            repo.changePassword(vaultKey, new)
                            Toast.makeText(this, "Password changed successfully", Toast.LENGTH_SHORT).show()
                        }
                    }
                }.start()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun toggleBiometric() {
        val bioEnabled = repo.getBiometricWrappedKey() != null
        if (bioEnabled) {
            AlertDialog.Builder(this)
                .setTitle("Disable Fingerprint")
                .setMessage("Remove fingerprint unlock? You can re-enable it later.")
                .setPositiveButton("Disable") { _, _ ->
                    repo.clearBiometricWrappedKey()
                    bioManager.deleteKey()
                    refreshUI()
                    Toast.makeText(this, "Fingerprint unlock disabled", Toast.LENGTH_SHORT).show()
                }
                .setNegativeButton("Cancel", null)
                .show()
        } else {
            val vaultKey = (application as PasslockApp).vaultKey ?: run {
                Toast.makeText(this, "Session expired", Toast.LENGTH_SHORT).show()
                return
            }
            try {
                bioManager.generateKey()
                val cipher = bioManager.encryptCipher()
                bioManager.authenticate(
                    activity = this,
                    title = "Enable Fingerprint",
                    subtitle = "Authenticate to register your fingerprint",
                    cipher = cipher,
                    onSuccess = { encCipher ->
                        val wrapped = bioManager.encryptWithCipher(encCipher, vaultKey)
                        repo.storeBiometricWrappedKey(wrapped)
                        refreshUI()
                        Toast.makeText(this, "Fingerprint unlock enabled", Toast.LENGTH_SHORT).show()
                    },
                    onFallback = {},
                    onError = { msg -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }
                )
            } catch (e: Exception) {
                Toast.makeText(this, "Could not set up fingerprint: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
