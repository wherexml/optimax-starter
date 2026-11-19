<?php

namespace App\Core\Http;

use App\Core\Contracts\ContractRefines;
use App\Core\Contracts\SchemaRegistry;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * 契约校验请求基类（LB-03）：业务路由的入参校验唯一入口。
 *
 * 子类只声明 `contract()`（packages/api/json-schema 产物名）与可选的接口层
 * 失败文案；字段级规则由 JSON Schema 产物消费，跨字段语义由 ContractRefines
 * 按 refines.json 同口径实现。校验失败统一走 { error } 错误协议（见
 * bootstrap/app.php 渲染器），文案语义对齐现有 Hono 栈的接口层通用文案。
 */
abstract class SchemaRequest extends FormRequest
{
    /** 契约产物名，如 'contracts.accountCreateSchema'。 */
    abstract protected function contract(): string;

    /** 校验失败的接口层文案（对齐现有 Hono 各端点的通用文案语义）。 */
    protected function contractError(): string
    {
        return '请求参数无效';
    }

    /** @return array<string, mixed> 字段级规则为空：校验全部来自契约产物。 */
    public function rules(): array
    {
        return [];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $v): void {
            $data = $this->all();
            $registry = SchemaRegistry::make();

            $schemaError = $registry->validate($this->contract(), $data);
            if ($schemaError !== null) {
                $v->errors()->add('contract', $this->contractError());

                return;
            }

            $refineError = (new ContractRefines)->check($this->contract(), $data);
            if ($refineError !== null) {
                $v->errors()->add('contract', $this->contractError());
            }
        });
    }
}
