package com.passlock.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.passlock.data.PasswordEntry
import com.passlock.databinding.ItemPasswordBinding

class PasswordAdapter(
    private val onCopy: (PasswordEntry) -> Unit,
    private val onEdit: (PasswordEntry) -> Unit,
    private val onDelete: (PasswordEntry) -> Unit
) : ListAdapter<PasswordEntry, PasswordAdapter.ViewHolder>(DIFF) {

    private companion object {
        val DIFF = object : DiffUtil.ItemCallback<PasswordEntry>() {
            override fun areItemsTheSame(a: PasswordEntry, b: PasswordEntry) = a.id == b.id
            override fun areContentsTheSame(a: PasswordEntry, b: PasswordEntry) = a == b
        }
    }

    inner class ViewHolder(private val binding: ItemPasswordBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(entry: PasswordEntry) {
            binding.tvTitle.text = entry.title
            binding.tvUsername.text = entry.username.ifBlank { entry.url.ifBlank { "No username" } }
            binding.tvInitial.text = entry.title.firstOrNull()?.uppercase() ?: "?"

            val colors = listOf(
                0xFF5C6BC0.toInt(), 0xFF26A69A.toInt(), 0xFFEF5350.toInt(),
                0xFFAB47BC.toInt(), 0xFF42A5F5.toInt(), 0xFFFF7043.toInt()
            )
            val colorIndex = (entry.title.hashCode() and Int.MAX_VALUE) % colors.size
            binding.tvInitial.background.mutate().setTint(colors[colorIndex])

            binding.btnCopy.setOnClickListener { onCopy(entry) }
            binding.btnEdit.setOnClickListener { onEdit(entry) }
            binding.btnDelete.setOnClickListener { onDelete(entry) }
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemPasswordBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }
}
