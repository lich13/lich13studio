# 日志使用

renderer 使用 `src/renderer/src/services/LoggerService.ts`。通过 `@logger` 取得实例，按模块指定 context；不要绕过服务直接输出用户数据。

```ts
const logger = loggerService.withContext('Module')
logger.info('Request finished', { status: 200, durationMs: 250 })
```

`packages/shared/logSanitizer.ts` 在写入前处理结构化字段和字符串，过滤凭据、备份密码、授权、Cookie、请求／响应正文及已识别的内嵌敏感值。错误只记录经过过滤的必要信息，不保存完整错误对象或调用栈中的用户内容。调用方仍应只传必要诊断字段；未知字符串无法保证自动识别所有个人数据。

测试使用 `example.invalid`、回环地址和虚拟凭据。不要把真实 API Key、备份密码、完整链接或聊天内容写入测试与日志。提供反馈前再次人工检查。

共享脱敏回归在 `packages/shared/logSanitizer.test.ts`。日志清理不能删除用户数据目录。
