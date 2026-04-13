package com.passlock

import android.os.Bundle
import android.view.MenuItem
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.passlock.data.PasswordEntry
import com.passlock.data.VaultRepository
import com.passlock.databinding.ActivityAddEditPasswordBinding
import java.security.SecureRandom

class AddEditPasswordActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_ENTRY_ID = "entry_id"
    }

    private lateinit var binding: ActivityAddEditPasswordBinding
    private lateinit var repo: VaultRepository
    private var existingEntry: PasswordEntry? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAddEditPasswordBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        repo = VaultRepository(this)

        val entryId = intent.getStringExtra(EXTRA_ENTRY_ID)
        if (entryId != null) {
            loadEntry(entryId)
            supportActionBar?.title = "Edit Password"
        } else {
            supportActionBar?.title = "Add Password"
        }

        binding.btnGenerate.setOnClickListener { generatePassword() }
        binding.btnSave.setOnClickListener { save() }

        binding.btnTogglePassword.setOnClickListener {
            val type = binding.etPassword.inputType
            if (type == (android.text.InputType.TYPE_CLASS_TEXT or
                        android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD)) {
                binding.etPassword.inputType = android.text.InputType.TYPE_CLASS_TEXT or
                        android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                binding.btnTogglePassword.setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            } else {
                binding.etPassword.inputType = android.text.InputType.TYPE_CLASS_TEXT or
                        android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
                binding.btnTogglePassword.setImageResource(android.R.drawable.ic_menu_view)
            }
            binding.etPassword.setSelection(binding.etPassword.text?.length ?: 0)
        }
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == android.R.id.home) { finish(); return true }
        return super.onOptionsItemSelected(item)
    }

    private fun loadEntry(id: String) {
        val key = (application as PasslockApp).vaultKey ?: return
        Thread {
            val entries = repo.readEntries(key)
            val entry = entries.find { it.id == id }
            runOnUiThread {
                if (entry != null) {
                    existingEntry = entry
                    binding.etTitle.setText(entry.title)
                    binding.etUsername.setText(entry.username)
                    binding.etPassword.setText(entry.password)
                    binding.etUrl.setText(entry.url)
                    binding.etNotes.setText(entry.notes)
                }
            }
        }.start()
    }

    private fun generatePassword() {
        val length = 20
        val upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        val lower = "abcdefghijklmnopqrstuvwxyz"
        val digits = "0123456789"
        val symbols = "!@#\$%^&*()-_=+[]{}|;:,.<>?"
        val all = upper + lower + digits + symbols
        val rng = SecureRandom()

        val pw = StringBuilder(length).apply {
            // Guarantee at least one of each category
            append(upper[rng.nextInt(upper.length)])
            append(lower[rng.nextInt(lower.length)])
            append(digits[rng.nextInt(digits.length)])
            append(symbols[rng.nextInt(symbols.length)])
            repeat(length - 4) { append(all[rng.nextInt(all.length)]) }
        }.toString().toList().shuffled(rng).joinToString("")

        binding.etPassword.setText(pw)
        binding.etPassword.inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
    }

    private fun save() {
        val title = binding.etTitle.text.toString().trim()
        val username = binding.etUsername.text.toString().trim()
        val password = binding.etPassword.text.toString()
        val url = binding.etUrl.text.toString().trim()
        val notes = binding.etNotes.text.toString().trim()

        binding.tilTitle.error = null
        binding.tilPassword.error = null

        if (title.isBlank()) { binding.tilTitle.error = "Title is required"; return }
        if (password.isBlank()) { binding.tilPassword.error = "Password is required"; return }

        val key = (application as PasslockApp).vaultKey ?: run {
            Toast.makeText(this, "Session expired, please unlock again", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        binding.btnSave.isEnabled = false

        Thread {
            val entries = repo.readEntries(key).toMutableList()
            val existing = existingEntry
            if (existing != null) {
                val idx = entries.indexOfFirst { it.id == existing.id }
                if (idx >= 0) entries[idx] = existing.copy(
                    title = title, username = username, password = password,
                    url = url, notes = notes, updatedAt = System.currentTimeMillis()
                )
            } else {
                entries.add(PasswordEntry(
                    title = title, username = username, password = password,
                    url = url, notes = notes
                ))
            }
            repo.saveEntries(entries, key)
            runOnUiThread {
                Toast.makeText(this,
                    if (existing != null) "Entry updated" else "Entry saved",
                    Toast.LENGTH_SHORT).show()
                finish()
            }
        }.start()
    }
}
