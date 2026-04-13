package com.passlock.data

import java.util.UUID

data class PasswordEntry(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val username: String = "",
    val password: String,
    val url: String = "",
    val notes: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)
