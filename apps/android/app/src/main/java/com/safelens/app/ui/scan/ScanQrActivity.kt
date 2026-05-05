package com.safelens.app.ui.scan

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.ImageButton
import android.widget.TextView

import androidx.activity.ComponentActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

import com.google.zxing.ResultPoint
import com.google.zxing.client.android.Intents
import com.journeyapps.barcodescanner.BarcodeView
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult

import com.safelens.app.R

class ScanQrActivity : ComponentActivity() {
    private lateinit var barcodeView: BarcodeView
    private lateinit var statusText: TextView
    private var hasHandledResult = false

    private val barcodeCallback = object : BarcodeCallback {
        override fun barcodeResult(result: BarcodeResult?) {
            val contents = result?.text ?: return
            if (hasHandledResult) {
                return
            }

            hasHandledResult = true
            statusText.text = getString(R.string.scan_status_detected)

            setResult(
                Activity.RESULT_OK,
                Intent().putExtra(Intents.Scan.RESULT, contents)
            )
            finish()
        }

        override fun possibleResultPoints(resultPoints: MutableList<ResultPoint>?) = Unit
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_scan_qr)

        barcodeView = findViewById(R.id.scanner_view)
        statusText = findViewById(R.id.scan_status)

        findViewById<ImageButton>(R.id.close_button).setOnClickListener {
            setResult(Activity.RESULT_CANCELED)
            finish()
        }

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.scan_root)) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.updatePadding(top = systemBars.top, bottom = systemBars.bottom)
            insets
        }

        barcodeView.decodeContinuous(barcodeCallback)
    }

    override fun onResume() {
        super.onResume()
        hasHandledResult = false
        statusText.text = getString(R.string.scan_status_searching)
        barcodeView.resume()
    }

    override fun onPause() {
        barcodeView.pause()
        super.onPause()
    }
}
