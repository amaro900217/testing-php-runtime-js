<?php

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

// --- Polyfill para OpenSSL (no cifrado real) ---
if (!function_exists('openssl_cipher_iv_length')) {
    function openssl_cipher_iv_length($cipher) {
        // Laravel espera 16 para AES-256-CBC
        return 16;
    }
}

if (!function_exists('openssl_random_pseudo_bytes')) {
    function openssl_random_pseudo_bytes($length) {
        return random_bytes($length); // usa core de PHP
    }
}

if (!function_exists('openssl_encrypt')) {
    function openssl_encrypt($data, $cipher, $key, $options = 0, $iv = "", &$tag = null) {
        // Polyfill inseguro → no cifra nada, pero define $tag
        $tag = str_repeat("\0", 16); // solo para que exista
        return $data;
    }
}

if (!function_exists('openssl_decrypt')) {
    function openssl_decrypt($data, $cipher, $key, $options = 0, $iv = "", $tag = null) {
        return $data;
    }
}


define('LARAVEL_START', microtime(true));

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Bootstrap Laravel and handle the request...
/** @var Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

$app->handleRequest(Request::capture());
