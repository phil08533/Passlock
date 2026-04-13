package com.passlock

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SearchView
import com.passlock.data.PasswordEntry
import com.passlock.data.VaultRepository
import com.passlock.databinding.ActivityVaultBinding
import com.passlock.ui.PasswordAdapter

class VaultActivity : AppCompatActivity() {

    private lateinit var binding: ActivityVaultBinding
    private lateinit var repo: VaultRepository
    private lateinit var adapter: PasswordAdapter
    private var allEntries: List<PasswordEntry> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Prevent screenshots and recent-apps thumbnail from showing vault contents
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        binding = ActivityVaultBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)

        repo = VaultRepository(this)

        adapter = PasswordAdapter(
            onCopy = { entry -> copyPassword(entry) },
            onEdit = { entry ->
                startActivity(
                    Intent(this, AddEditPasswordActivity::class.java)
                        .putExtra(AddEditPasswordActivity.EXTRA_ENTRY_ID, entry.id)
                )
            },
            onDelete = { entry -> confirmDelete(entry) }
        )
        binding.recyclerView.adapter = adapter

        binding.fabAdd.setOnClickListener {
            startActivity(Intent(this, AddEditPasswordActivity::class.java))
        }
    }

    override fun onResume() {
        super.onResume()
        val key = (application as PasslockApp).vaultKey
        if (key == null) {
            goToLock()
            return
        }
        loadEntries()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.vault_menu, menu)
        val searchItem = menu.findItem(R.id.action_search)
        val searchView = searchItem.actionView as SearchView
        searchView.queryHint = "Search passwords…"
        searchView.setOnQueryTextListener(object : SearchView.OnQueryTextListener {
            override fun onQueryTextSubmit(q: String?) = false
            override fun onQueryTextChange(q: String?): Boolean {
                filterEntries(q.orEmpty())
                return true
            }
        })
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_lock -> { lockVault(); true }
            R.id.action_settings -> {
                startActivity(Intent(this, SettingsActivity::class.java)); true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun loadEntries() {
        val key = (application as PasslockApp).vaultKey ?: return
        Thread {
            val entries = repo.readEntries(key).sortedBy { it.title.lowercase() }
            runOnUiThread {
                allEntries = entries
                adapter.submitList(entries)
                binding.emptyState.visibility = if (entries.isEmpty()) View.VISIBLE else View.GONE
            }
        }.start()
    }

    private fun filterEntries(query: String) {
        val filtered = if (query.isBlank()) allEntries
        else allEntries.filter {
            it.title.contains(query, true) ||
            it.username.contains(query, true) ||
            it.url.contains(query, true)
        }
        adapter.submitList(filtered)
        binding.emptyState.visibility = if (filtered.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun copyPassword(entry: PasswordEntry) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("password", entry.password))
        Toast.makeText(this, "Password copied — clears in 30s", Toast.LENGTH_SHORT).show()

        // Auto-clear clipboard after 30 seconds
        binding.root.postDelayed({
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                cm.clearPrimaryClip()
            } else {
                cm.setPrimaryClip(ClipData.newPlainText("", ""))
            }
        }, 30_000)
    }

    private fun confirmDelete(entry: PasswordEntry) {
        AlertDialog.Builder(this)
            .setTitle("Delete Entry")
            .setMessage("Delete \"${entry.title}\"? This cannot be undone.")
            .setPositiveButton("Delete") { _, _ ->
                val key = (application as PasslockApp).vaultKey ?: return@setPositiveButton
                val updated = allEntries.filter { it.id != entry.id }
                Thread {
                    repo.saveEntries(updated, key)
                    runOnUiThread { loadEntries() }
                }.start()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun lockVault() {
        (application as PasslockApp).lock()
        goToLock()
    }

    private fun goToLock() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
