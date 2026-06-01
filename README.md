# gusbotai

Статическая версия реестра сервисов для GitHub Pages.

## Как это устроено

- `docs/index.html` — страница для поиска и проверки сервисов
- `docs/data/services.json` — JSON-источник, который читает и страница, и внешнее приложение
- `.github/workflows/daily-refresh.yml` — ежедневное обновление JSON через GitHub Actions
- `scripts/refresh_services.py` — скрипт автопроверки доступности сайтов

## Что получает приложение

Приложение может читать JSON напрямую по URL вида:

```text
https://sophievyb.github.io/gusbotai/data/services.json
```

Внутри файла лежат:

- статусы по РФ/РБ
- registration/login/post-login
- free tier
- alternatives
- bot_status
- last_auto_refresh / last_auto_status / last_auto_http_code / last_auto_note

## Как включить GitHub Pages

1. Откройте репозиторий `sophievyb/gusbotai`
2. Перейдите в `Settings` → `Pages`
3. В `Build and deployment` выберите:
   - `Source` → `Deploy from a branch`
   - `Branch` → `main`
   - `Folder` → `/docs`
4. Нажмите `Save`

После этого сайт будет доступен по адресу:

```text
https://sophievyb.github.io/gusbotai/
```

## Как обновлять вручную

1. Откройте сайт на GitHub Pages
2. Отредактируйте карточку сервиса
3. Нажмите `Export JSON`
4. Загрузите скачанный `services.json` в `docs/data/services.json` в GitHub

## Как работает ежедневное обновление

- GitHub Actions каждый день запускает `scripts/refresh_services.py`
- скрипт проверяет `url` и `status_url`
- обновляется файл `docs/data/services.json`
- workflow коммитит изменения обратно в репозиторий

Важно: это не проверка логина и post-login через аккаунт. Это ежедневная автопроверка доступности сайта и status URL.
