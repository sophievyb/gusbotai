# AI Service Registry

Локальный веб-сервис для хранения статусов доступности нейросетей и генерации готового ответа для приложения.

## Что есть

- `SQLite` база с карточками сервисов
- `GET /api/check?service=<name>&region=RF|RB` для приложения
- админ-страница для поиска и редактирования карточек
- встроенное ежедневное автообновление доступности сайта и optional `status_url`
- стартовые записи для `ChatGPT`, `ask.chadgpt.ru`, `Photopea`

## Запуск

```bash
python3 /Users/sophie/Documents/Codex/2026-06-01/files-mentioned-by-the-user-pasted/outputs/ai-service-web/server.py --port 9001
```

После запуска:

- UI: `http://127.0.0.1:8765/`
- healthcheck: `http://127.0.0.1:8765/health`
- API example:

```bash
curl 'http://127.0.0.1:8765/api/check?service=ChatGPT&region=RF'
```

## Основные endpoint'ы

- `GET /api/services?query=chat`
- `GET /api/services/<id>`
- `GET /api/services/<service-name>`
- `GET /api/check?service=ChatGPT&region=RF`
- `GET /api/refresh/run?force=1`
- `POST /api/services/upsert`

## Как работает ежедневное обновление

- при старте сервер запускает `daily refresh`, если сегодня он ещё не выполнялся
- затем фоновый scheduler раз в час проверяет, нужно ли обновление на текущую дату
- автообновление проверяет `url` и, если указан, `status_url`
- результат пишется в поля `last_auto_refresh`, `last_auto_status`, `last_auto_http_code`, `last_auto_note`

Важно: это честная автопроверка доступности сайта и status-страницы. Логин, регистрация и работа после входа по-прежнему требуют ручной или отдельной интеграционной проверки.

Пример тела `POST /api/services/upsert`:

```json
{
  "name": "Canva",
  "url": "https://www.canva.com/",
  "category": "design",
  "refresh_enabled": "yes",
  "status_url": "https://www.canva.com/",
  "rf_without_vpn": "partial",
  "rb_without_vpn": "partial",
  "registration": "works",
  "login": "works",
  "post_login": "manual",
  "free_tier": "freemium",
  "phone_required": "unknown",
  "card_required": "no",
  "vpn_required": "unknown",
  "alternatives": ["Figma", "Pixlr"],
  "official_support": ["US", "DE"],
  "sources": ["manual check", "official site"],
  "last_checked": "2026-06-01",
  "owner": "methodist",
  "response_comment": "Нужно отдельно проверить AI-функции.",
  "bot_status": "partial"
}
```
