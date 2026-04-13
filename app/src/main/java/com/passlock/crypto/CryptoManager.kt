package com.passlock.crypto

import android.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import java.security.SecureRandom

data class WrappedKey(val iv: String, val data: String)

object CryptoManager {

    private const val KEY_SIZE = 256
    private const val GCM_TAG_LENGTH = 128
    private const val GCM_IV_SIZE = 12
    private const val SALT_SIZE = 32
    private const val PBKDF2_ITERATIONS = 310_000
    private const val PBKDF2_ALGORITHM = "PBKDF2WithHmacSHA256"
    private const val AES_GCM = "AES/GCM/NoPadding"

    fun generateSalt(): ByteArray {
        val salt = ByteArray(SALT_SIZE)
        SecureRandom().nextBytes(salt)
        return salt
    }

    fun generateVaultKey(): SecretKey {
        val kg = KeyGenerator.getInstance("AES")
        kg.init(KEY_SIZE, SecureRandom())
        return kg.generateKey()
    }

    fun deriveKeyFromPassword(password: String, salt: ByteArray): SecretKey {
        val spec = PBEKeySpec(password.toCharArray(), salt, PBKDF2_ITERATIONS, KEY_SIZE)
        val keyBytes = SecretKeyFactory.getInstance(PBKDF2_ALGORITHM)
            .generateSecret(spec)
            .encoded
        spec.clearPassword()
        return SecretKeySpec(keyBytes, "AES")
    }

    fun encrypt(plaintext: ByteArray, key: SecretKey): Pair<ByteArray, ByteArray> {
        val iv = ByteArray(GCM_IV_SIZE)
        SecureRandom().nextBytes(iv)
        val cipher = Cipher.getInstance(AES_GCM)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LENGTH, iv))
        return Pair(iv, cipher.doFinal(plaintext))
    }

    fun decrypt(iv: ByteArray, ciphertext: ByteArray, key: SecretKey): ByteArray {
        val cipher = Cipher.getInstance(AES_GCM)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LENGTH, iv))
        return cipher.doFinal(ciphertext)
    }

    fun wrapKey(keyToWrap: SecretKey, wrappingKey: SecretKey): WrappedKey {
        val (iv, ciphertext) = encrypt(keyToWrap.encoded, wrappingKey)
        return WrappedKey(
            iv = Base64.encodeToString(iv, Base64.NO_WRAP),
            data = Base64.encodeToString(ciphertext, Base64.NO_WRAP)
        )
    }

    fun unwrapKey(wrapped: WrappedKey, wrappingKey: SecretKey): SecretKey {
        val iv = Base64.decode(wrapped.iv, Base64.NO_WRAP)
        val ct = Base64.decode(wrapped.data, Base64.NO_WRAP)
        return SecretKeySpec(decrypt(iv, ct, wrappingKey), "AES")
    }
}
