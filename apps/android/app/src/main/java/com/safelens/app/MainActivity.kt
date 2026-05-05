package com.safelens.app

import android.os.Bundle

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.viewmodel.compose.viewModel

import com.safelens.app.ui.PairingViewModel
import com.safelens.app.ui.PairingViewModelFactory
import com.safelens.app.ui.SafeLensApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val repository = (application as SafeLensApplication).container.deviceRepository

        setContent {
            val viewModel: PairingViewModel = viewModel(
                factory = PairingViewModelFactory(
                    application = application,
                    repository = repository
                )
            )
            SafeLensApp(viewModel = viewModel)
        }
    }
}

