<?php

use App\Modules\Attachments\AttachmentsController as Controller;
use Illuminate\Support\Facades\Route;

// 附件模块（LD-02）；由 routes/api.php 的 glob 自动装载（守卫 + /console 前缀就位）。
// file 出口为会话 + HMAC 双重校验：链接 TTL 来自契约产物，复制到无会话环境不可用。
Route::get('/attachments', [Controller::class, 'index'])->middleware('console.permission:attachments:read');
Route::post('/attachments', [Controller::class, 'store'])->middleware('console.permission:attachments:manage');
Route::get('/attachments/{id}/url', [Controller::class, 'url'])->whereNumber('id')->middleware('console.permission:attachments:read');
Route::get('/attachments/file/{id}', [Controller::class, 'serve'])->whereNumber('id');
Route::delete('/attachments/{id}', [Controller::class, 'destroy'])->whereNumber('id')->middleware('console.permission:attachments:manage');
