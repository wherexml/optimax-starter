<?php

// 对齐现有栈 argon2id PHC 参数（m=65536, t=2, p=1；apps/ai-service/src/password.ts），
// 保证新旧哈希互认（password_verify 读取 PHC 自带参数串，显式对齐使新哈希参数一致）。
return [
    'driver' => 'argon2id',

    'bcrypt' => ['rounds' => 12],

    'argon' => [
        'memory' => 65536,
        'threads' => 1,
        'time' => 2,
    ],

    'auto_rehash' => true,

    'rehash_on_login' => false,
];
