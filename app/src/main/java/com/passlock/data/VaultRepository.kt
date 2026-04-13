package com.passlock.data

import android.content.Context
import android.util.Base64
import com.google.gson.Gson
import com.passlock.crypto.CryptoManager
import com.passlock.crypto.WrappedKey
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

class VaultRepository(private val context: Context) {

    private val gson = Gson()
    private val vaultFile get() = context.getFileStreamPath("vault.json")

    private data class VaultFile(
        val version: Int = 1,
        val salt: String,
        val passwordWrappedKey: WrappedKey,
        val biometricWrappedKey: WrappedKey? = null,
        val vaultIv: String,
        val vaultData: String
    )

    private data class VaultContents(val entries: List<PasswordEntry> = emptyList())

    fun vaultExists(): Boolean = vaultFile.exists()

    /** First-time setup: creates encrypted vault and returns the in-memory vault key. */
    fun createVault(masterPassword: String): SecretKey {
        val salt = CryptoManager.generateSalt()
        val vaultKey = CryptoManager.generateVaultKey()
        val passwordKey = CryptoManager.deriveKeyFromPassword(masterPassword, salt)
        val wrappedKey = CryptoManager.wrapKey(vaultKey, passwordKey)

        val (vaultIv, vaultData) = CryptoManager.encrypt(
            gson.toJson(VaultContents()).toByteArray(Charsets.UTF_8),
            vaultKey
        )

        saveVaultFile(
            VaultFile(
                salt = Base64.encodeToString(salt, Base64.NO_WRAP),
                passwordWrappedKey = wrappedKey,
                vaultIv = Base64.encodeToString(vaultIv, Base64.NO_WRAP),
                vaultData = Base64.encodeToString(vaultData, Base64.NO_WRAP)
            )
        )
        return vaultKey
    }

    /** Returns vault key on success, null on wrong password. */
    fun unlockWithPassword(password: String): SecretKey? {
        val file = readVaultFile() ?: return null
        return try {
            val salt = Base64.decode(file.salt, Base64.NO_WRAP)
            val passwordKey = CryptoManager.deriveKeyFromPassword(password, salt)
            CryptoManager.unwrapKey(file.passwordWrappedKey, passwordKey)
        } catch (e: Exception) {
            null
        }
    }

    fun readEntries(vaultKey: SecretKey): List<PasswordEntry> {
        val file = readVaultFile() ?: return emptyList()
        return try {
            val iv = Base64.decode(file.vaultIv, Base64.NO_WRAP)
            val ct = Base64.decode(file.vaultData, Base64.NO_WRAP)
            val json = String(CryptoManager.decrypt(iv, ct, vaultKey), Charsets.UTF_8)
            gson.fromJson(json, VaultContents::class.java).entries
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun saveEntries(entries: List<PasswordEntry>, vaultKey: SecretKey) {
        val file = readVaultFile() ?: return
        val (iv, ct) = CryptoManager.encrypt(
            gson.toJson(VaultContents(entries)).toByteArray(Charsets.UTF_8),
            vaultKey
        )
        saveVaultFile(
            file.copy(
                vaultIv = Base64.encodeToString(iv, Base64.NO_WRAP),
                vaultData = Base64.encodeToString(ct, Base64.NO_WRAP)
            )
        )
    }

    fun storeBiometricWrappedKey(wrapped: WrappedKey) {
        val file = readVaultFile() ?: return
        saveVaultFile(file.copy(biometricWrappedKey = wrapped))
    }

    fun clearBiometricWrappedKey() {
        val file = readVaultFile() ?: return
        saveVaultFile(file.copy(biometricWrappedKey = null))
    }

    fun getBiometricWrappedKey(): WrappedKey? = readVaultFile()?.biometricWrappedKey

    fun changePassword(currentVaultKey: SecretKey, newPassword: String) {
        val file = readVaultFile() ?: return
        val newSalt = CryptoManager.generateSalt()
        val newPasswordKey = CryptoManager.deriveKeyFromPassword(newPassword, newSalt)
        val newWrappedKey = CryptoManager.wrapKey(currentVaultKey, newPasswordKey)
        saveVaultFile(
            file.copy(
                salt = Base64.encodeToString(newSalt, Base64.NO_WRAP),
                passwordWrappedKey = newWrappedKey
            )
        )
    }

    private fun readVaultFile(): VaultFile? {
        if (!vaultFile.exists()) return null
        return try {
            gson.fromJson(vaultFile.readText(), VaultFile::class.java)
        } catch (e: Exception) {
            null
        }
    }

    private fun saveVaultFile(data: VaultFile) {
        vaultFile.writeText(gson.toJson(data))
    }
}
