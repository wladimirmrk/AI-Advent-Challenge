# Code Review: PR #2 - Update main.yml

- **Repository:** `CryptoTrack`
- **Author:** `@wladimirmrk`
- **Model:** `nvidia/nemotron-3-ultra-550b-a55b:free`
- **RAG Chunks Used:** 6
- **Generated At:** 2026-10-19 08:52:33
- **Tokens:** 4287 (prompt: 1787, completion: 2500)
- **Latency:** 23.37s

---

## 1. 📋 Резюме изменений (Executive Summary)

**Суть изменений:**  
PR преобразует workflow-файл `.github/workflows/main.yml` из общего теста self-hosted runner'а (bash/Linux-ориентированный) в специализированный тест **Windows self-hosted runner'а** с использованием PowerShell Core (`pwsh`).

**Ключевые изменения:**
- `runs-on: self-hosted` → `runs-on: [self-hosted, windows]` (селекция по меткам).
- `shell: bash` → `shell: pwsh`.
- Команды переведены с bash (`echo`, `pwd`, `ls`, `date`) на PowerShell (`Write-Host`, `Get-Location`, `Get-ChildItem`, `Get-Date`).
- Добавлена диагностика версии PowerShell (`$PSVersionTable.PSVersion`).

**Контекст:**  
В `README.md` указано, что основной CI-гейт выполняется через `.github/workflows/build.yml` при push/PR в `main`. Данный `main.yml` триггерится только вручную (`workflow_dispatch`), что указывает на его вспомогательный/диагностический характер (smoke-test раннера).

---

## 2. 🐛 Потенциальные баги и граничные случаи (Potential Bugs & Edge Cases)

| # | Проблема | Риск | Обоснование |
|---|----------|------|-------------|
| **1** | **Отсутствие `actions/checkout`** | 🟡 Medium | Workflow не делает checkout кода. Если цель — прогонять `./gradlew ...` (как в README), шаг отсутствует. Текущий скрипт лишь печатает окружение. |
| **2** | **Жесткая зависимость от `pwsh` (PowerShell 7+)** | 🟡 Medium | `shell: pwsh` требует установленного **PowerShell Core (7.x+)**. На чистом Windows-раннере по умолчанию есть только `powershell` (5.1). Если `pwsh` не в PATH — джоб упадет с `File not found`. Безопаснее: `shell: powershell` (встроенный) или явная установка `pwsh` через `setup-powershell` action. |
| **3** | **Отсутствие `continue-on-error` / таймаутов** | 🟢 Low | Диагностический джоб может зависнуть, если раннер загружен. Рекомендуется `timeout-minutes: 10` на job/step. |
| **4** | **`workflow_dispatch` без входных параметров** | 🟢 Low | Нельзя передать параметры (например, ветку для чекаута или флаг `--stacktrace`). Для ручного запуска CI это ограничивает гибкость. |
| **5** | **Имя файла `main.yml` конфликтует с семантикой** | 🟢 Low | В README CI-гейт — `build.yml`. Файл `main.yml` в корне workflows часто ожидается как *основной* пайплайн. Переименовать в `windows-runner-diagnostics.yml` или `test-windows-runner.yml` для ясности. |
| **6** | **Отсутствие описания PR и Conventional Commits** | 🟠 Process | В PR нет описания (`Описание отсутствует`). Коммиты в ветке `wladimirmrk-patch-2` должны следовать Conventional Commits (`ci: ...`, `chore: ...`). Это нарушает процесс (ADR-018, AGENTS.md). |

---

## 3. 🏛️ Архитектурный анализ и инварианты (Architecture & Invariants)

| Инвариант | Статус | Комментарий |
|-----------|--------|-------------|
| **CI/CD Safety (ADR-018, AGENTS.md)** | ⚠️ **Требует внимания** | Смена шелла на `pwsh` без гарантии наличия runtime на раннере — риск "works on my machine". Необходимо либо зафиксировать требование к раннеру (Docker/VM image с `pwsh`), либо использовать нативный `powershell`. |
| **Offline-first / Single Source of Truth** | ✅ N/A | Не применимо к CI-конфигурации. |
| **Модульность (core/feature/app)** | ✅ N/A | Не применимо. |
| **Conventional Commits / Гигиена репозитория** | ❌ **Нарушено** | PR без описания, название ветки `patch-2` не несет семантики. История коммитов должна быть чистой (`ci: migrate main.yml to windows pwsh`). |
| **Идемпотентность и воспроизводимость** | ⚠️ **Частично** | Без `actions/checkout` и кэша Gradle этот workflow не воспроизводит билд. Как smoke-test раннера — ок, как часть CI — нет. |

---

## 4. 💡 Рекомендации и примеры улучшений (Recommendations & Best Practices)

### 4.1. Исправить шелл на нативный `powershell` или добавить setup
```yaml
# Вариант А: Использовать встроенный Windows PowerShell 5.1 (гарантированно есть)
shell: powershell

# Вариант Б: Явно установить PowerShell 7+ (если нужны современные фичи)
- name: Setup PowerShell 7
  uses: actions/setup-powershell@v1
  with:
    version: '7.4.x' # или 'latest'
- name: Run PowerShell commands
  shell: pwsh
```

### 4.2. Добавить `actions/checkout` и кэш Gradle (если это пред-CI проверка)
```yaml
steps:
  - name: Checkout repository
    uses: actions/checkout@v4

  - name: Setup JDK 21
    uses: actions/setup-java@v4
    with:
      distribution: 'temurin'
      java-version: '21'
      cache: gradle

  - name: Grant execute permission for gradlew
    run: chmod +x gradlew
    shell: bash # или pwsh: (Get-Item gradlew).IsReadOnly = $false

  - name: Run CI Gate (per README)
    run: ./gradlew assembleDebug testDebugUnitTest detekt lint
    shell: pwsh # или bash, если gradlew работает
```

### 4.3. Переименовать файл и добавить метаданные
```diff
- name: Windows Self-hosted runner test
+ name: "CI: Windows Self-hosted Runner Diagnostics"
 
 on:
   workflow_dispatch:
+    inputs:
+      run-full-gate:
+        description: 'Run full ./gradlew gate after diagnostics'
+        type: boolean
+        default: false
 
 jobs:
   diagnostics:
+    timeout-minutes: 15
     runs-on: [self-hosted, windows]
     steps:
       - name: Run PowerShell diagnostics
         shell: powershell # или pwsh с setup
         run: |
           Write-Host "=== Runner Diagnostics ==="
           Write-Host "Hostname: $env:COMPUTERNAME"
           Write-Host "User: $env:USERNAME"
           Write-Host "Current directory: $(Get-Location)"
           Write-Host "PowerShell version: $($PSVersionTable.PSVersion)"
           Write-Host "Current date: $(Get-Date)"
           Write-Host "Directory contents:"
           Get-ChildItem
