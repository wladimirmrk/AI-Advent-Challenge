#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🔥 День 5. Версии моделей через Groq API (Week 1, Task 5)
AI Advent Challenge

Сравнение трёх классов моделей на Groq API (слабая, средняя, сильная)
на логической задаче с многошаговым расчётом и строгим JSON-выводом.

Модели по умолчанию:
- Слабая  : openai/gpt-oss-20b
- Средняя : qwen/qwen3.8-27b
- Сильная : openai/gpt-oss-120b

Замеряются:
- Время ответа (сек)
- Количество токенов (Prompt, Completion, Total)
- Скорость генерации (токен/сек) на Groq LPU

Сравниваются:
- Качество ответов (точность подсчёта фруктов, валидность JSON, следование схеме и запрету на текст до/после)
- Скорость (LPU throughput)
- Ресурсоёмкость (размер вывода, токены)
"""

import os
import sys
import time
import json
import argparse
import requests
from dotenv import load_dotenv

# Обеспечиваем корректный вывод UTF-8 в консоли Windows
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Загрузка конфигурации из .env
script_dir = os.path.dirname(os.path.abspath(__file__))
dotenv_path = os.path.join(script_dir, ".env")
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)
else:
    load_dotenv()

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

# Значения моделей по умолчанию (если не заданы в .env)
DEFAULT_MODELS = {
    "weak": os.getenv("MODEL_WEAK", "openai/gpt-oss-20b").strip(),
    "medium": os.getenv("MODEL_MEDIUM", "qwen/qwen3.8-27b").strip(),
    "strong": os.getenv("MODEL_STRONG", "openai/gpt-oss-120b").strip(),
}

DEFAULT_PROMPT = """У меня в корзине было 4 яблока и 2 апельсина. Я съел одно яблоко, затем разрезал один апельсин пополам и отдал половину другу. Одно яблоко я обменял на две груши. Сколько у меня сейчас целых фруктов, сколько половинок, и какие именно это фрукты?

Твой ответ должен быть выведен строго в формате JSON по следующему шаблону (не пиши никакой текст до или после JSON):
{
"общее_число_целых": число,
"общее_число_половинок": число,
"какие_целые": {
"название_фрукта_1": количество,
"название_фрукта_2": количество,
"название_фрукта_3": количество
},
"какие_половинки": {
"название_фрукта": количество
},
"пояснение": "краткое объяснение расчетов на 1 предложение"
}"""


def get_api_key() -> str:
    """Получение и валидация Groq API ключа."""
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key or api_key == "your_groq_api_key_here":
        print("\n[ОШИБКА] API-ключ Groq не найден или не настроен!")
        print(f"Пожалуйста, откройте файл .env в папке {script_dir} и укажите ваш ключ:")
        print("  GROQ_API_KEY=gsk_ваш_ключ_groq")
        print(f"  MODEL_WEAK={DEFAULT_MODELS['weak']}")
        print(f"  MODEL_MEDIUM={DEFAULT_MODELS['medium']}")
        print(f"  MODEL_STRONG={DEFAULT_MODELS['strong']}")
        print("\nПолучить бесплатный API-ключ можно на https://console.groq.com/keys")
        print("(Шаблон доступен в файле .env.example)\n")
        sys.exit(1)
    return api_key


def call_model(model_name: str, prompt: str, api_key: str, temperature: float = 0.0, timeout: int = 120) -> dict:
    """
    Отправляет запрос к модели через Groq API с точным замером времени и токенов.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model_name,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": temperature,
    }

    start_time = time.perf_counter()
    try:
        response = requests.post(
            GROQ_API_URL,
            headers=headers,
            json=payload,
            timeout=timeout
        )
        elapsed_time = time.perf_counter() - start_time

        if response.status_code != 200:
            try:
                err_json = response.json()
                error_msg = err_json.get("error", {}).get("message", response.text)
            except Exception:
                error_msg = response.text
            return {
                "success": False,
                "error": f"HTTP {response.status_code}: {error_msg}",
                "elapsed_time": round(elapsed_time, 2),
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "throughput": 0.0,
                "content": "",
            }

        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            return {
                "success": False,
                "error": "Пустой ответ от модели (поле choices пусто)",
                "elapsed_time": round(elapsed_time, 2),
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "throughput": 0.0,
                "content": "",
            }

        content = choices[0].get("message", {}).get("content", "").strip()
        usage = data.get("usage", {})
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        total_tokens = usage.get("total_tokens", prompt_tokens + completion_tokens)

        # Вычисление пропускной способности (токенов в секунду)
        throughput = round(completion_tokens / elapsed_time, 2) if elapsed_time > 0 and completion_tokens > 0 else 0.0

        return {
            "success": True,
            "error": None,
            "elapsed_time": round(elapsed_time, 2),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "throughput": throughput,
            "content": content,
        }

    except requests.exceptions.Timeout:
        elapsed_time = time.perf_counter() - start_time
        return {
            "success": False,
            "error": f"Превышено время ожидания ответа ({timeout} сек)",
            "elapsed_time": round(elapsed_time, 2),
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "throughput": 0.0,
            "content": "",
        }
    except requests.exceptions.RequestException as e:
        elapsed_time = time.perf_counter() - start_time
        return {
            "success": False,
            "error": f"Сетевая ошибка: {e}",
            "elapsed_time": round(elapsed_time, 2),
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "throughput": 0.0,
            "content": "",
        }


def analyze_solution_quality(content: str) -> dict:
    """
    Детальный анализ ответа модели на соответствие задаче подсчёта фруктов и шаблону JSON.
    """
    if not content:
        return {
            "success": False,
            "valid_json": False,
            "strict_format": False,
            "whole_count": None,
            "half_count": None,
            "whole_fruits": {},
            "half_fruits": {},
            "explanation": "",
            "math_correct": False,
            "fields_ok": False,
            "issues": ["Ответ пустой или запрос завершился с ошибкой"],
            "status": "Нет ответа",
        }

    raw = content.strip()

    # Проверка на строгое отсутствие текста и markdown-обёрток до и после JSON
    strict_format = raw.startswith("{") and raw.endswith("}") and "```" not in raw

    # Попытка извлечь JSON для парсинга, даже если модель добавила ```json или текст
    clean_text = raw
    if "```" in clean_text:
        start_idx = clean_text.find("{")
        end_idx = clean_text.rfind("}")
        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            clean_text = clean_text[start_idx:end_idx + 1]
    elif not (clean_text.startswith("{") and clean_text.endswith("}")):
        start_idx = clean_text.find("{")
        end_idx = clean_text.rfind("}")
        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            clean_text = clean_text[start_idx:end_idx + 1]

    valid_json = False
    parsed_data = None
    try:
        parsed_data = json.loads(clean_text)
        if isinstance(parsed_data, dict):
            valid_json = True
    except Exception:
        valid_json = False

    issues = []
    if not strict_format:
        issues.append("Нарушен запрет на сторонний текст (есть markdown-обёртки ``` или текст вне JSON)")
    if not valid_json:
        issues.append("Невалидный JSON-синтаксис (ошибка парсинга)")

    whole_count = None
    half_count = None
    whole_fruits = {}
    half_fruits = {}
    explanation = ""
    math_correct = False
    fields_ok = False

    if valid_json and parsed_data:
        # Проверка обязательных полей
        required_fields = ["общее_число_целых", "общее_число_половинок", "какие_целые", "какие_половинки", "пояснение"]
        missing_fields = [f for f in required_fields if f not in parsed_data]
        if missing_fields:
            issues.append(f"Отсутствуют обязательные поля: {', '.join(missing_fields)}")
        else:
            fields_ok = True

        whole_count = parsed_data.get("общее_число_целых")
        half_count = parsed_data.get("общее_число_половинок")
        whole_fruits = parsed_data.get("какие_целые", {})
        half_fruits = parsed_data.get("какие_половинки", {})
        explanation = str(parsed_data.get("пояснение", "")).strip()

        # Проверка правильности вычислений:
        # 4 яблока, 2 апельсина ->
        # 1. съел 1 яблоко = 3 яблока, 2 апельсина
        # 2. разрезал 1 апельсин и отдал половину = 3 яблока, 1 целый апельсин, 1 половинка апельсина
        # 3. 1 яблоко обменял на 2 груши = 2 яблока, 1 апельсин, 2 груши (всего 5 целых) + 1 половинка апельсина
        whole_ok = (whole_count == 5)
        half_ok = (half_count == 1)

        if not whole_ok:
            issues.append(f"Неверное число целых фруктов: {whole_count} (ожидалось 5)")
        if not half_ok:
            issues.append(f"Неверное число половинок: {half_count} (ожидалось 1)")

        if whole_ok and half_ok:
            math_correct = True

    if math_correct and strict_format and fields_ok:
        status = "Идеально (5 целых, 1 пол., чистый JSON)"
    elif math_correct and fields_ok:
        status = "Верно (5 целых, 1 пол., но с markdown/текстом)"
    elif valid_json:
        status = f"Ошибка в расчетах (целых: {whole_count}, пол: {half_count})"
    else:
        status = "Невалидный JSON"

    return {
        "success": True,
        "valid_json": valid_json,
        "strict_format": strict_format,
        "whole_count": whole_count,
        "half_count": half_count,
        "whole_fruits": whole_fruits,
        "half_fruits": half_fruits,
        "explanation": explanation,
        "math_correct": math_correct,
        "fields_ok": fields_ok,
        "issues": issues,
        "status": status,
    }


def print_summary_table(results: dict):
    """Печатает красивую сводную таблицу результатов в консоль."""
    print("\n" + "=" * 108)
    print("                 📊 СВОДНЫЕ РЕЗУЛЬТАТЫ СРАВНЕНИЯ МОДЕЛЕЙ (GROQ API)")
    print("=" * 108)
    header = f"| {'Категория':<10} | {'Модель':<24} | {'Время (с)':<9} | {'In/Out':<10} | {'Ток/сек':<8} | {'JSON':<6} | {'Результат':<26} |"
    divider = "|-" + "-" * 10 + "-|-" + "-" * 24 + "-|-" + "-" * 9 + "-|-" + "-" * 10 + "-|-" + "-" * 8 + "-|-" + "-" * 6 + "-|-" + "-" * 26 + "-|"
    print(divider)
    print(header)
    print(divider)

    for category in ["weak", "medium", "strong"]:
        res = results.get(category, {})
        cat_title = {"weak": "Слабая", "medium": "Средняя", "strong": "Сильная"}.get(category, category)
        model_name = res.get("model", "—")
        if len(model_name) > 24:
            model_name = model_name[:21] + "..."

        if res.get("success"):
            time_str = f"{res['elapsed_time']:.2f}"
            in_out_str = f"{res['prompt_tokens']}/{res['completion_tokens']}"
            tp_str = f"{res['throughput']:.1f}"
            q = analyze_solution_quality(res["content"])
            json_str = "Да" if q["valid_json"] else "Нет"
            status_str = q["status"]
            if len(status_str) > 26:
                status_str = status_str[:23] + "..."
        else:
            time_str = f"{res.get('elapsed_time', 0):.2f}"
            in_out_str = "ERR"
            tp_str = "0.0"
            json_str = "Нет"
            status_str = f"Ошибка: {res.get('error', '')[:18]}"

        row = f"| {cat_title:<10} | {model_name:<24} | {time_str:<9} | {in_out_str:<10} | {tp_str:<8} | {json_str:<6} | {status_str:<26} |"
        print(row)

    print(divider)
    print("=" * 108)


def generate_markdown_report(results: dict, prompt: str, filename: str = "results.md"):
    """Формирует и сохраняет детализированный markdown-отчет, полностью адаптированный под промпт."""
    filepath = os.path.join(script_dir, filename)

    # 1. Строки сводной таблицы
    table_rows = []
    analysis_blocks = []

    for category in ["weak", "medium", "strong"]:
        res = results.get(category, {})
        cat_title = {"weak": "Слабая (Weak)", "medium": "Средняя (Medium)", "strong": "Сильная (Strong)"}[category]
        m_name = res.get("model", "—")

        if res.get("success"):
            q = analyze_solution_quality(res["content"])
            json_badge = "✅ Валидный" if q["valid_json"] else "❌ Ошибка"
            format_badge = "✅ Без текста" if q["strict_format"] else "⚠️ Markdown/текст"
            whole_display = f"{q['whole_count']}" if q["whole_count"] is not None else "—"
            half_display = f"{q['half_count']}" if q["half_count"] is not None else "—"

            if q["math_correct"]:
                res_badge = "✅ 5 целых, 1 пол."
            else:
                res_badge = f"❌ Целых: {whole_display}, пол: {half_display}"

            table_rows.append(
                f"| **{cat_title}** | `{m_name}` | {res['elapsed_time']}с | {res['prompt_tokens']} | "
                f"{res['completion_tokens']} | **{res['total_tokens']}** | {res['throughput']} т/с | "
                f"{json_badge} | {format_badge} | {res_badge} |"
            )

            # Формирование детального блока модели
            issues_text = ""
            if q["issues"]:
                issues_text = "\n".join([f"    - ⚠️ {issue}" for issue in q["issues"]])
            else:
                issues_text = "    - ✅ Замечаний нет, все требования промпта выполнены безупречно."

            whole_fruits_str = json.dumps(q["whole_fruits"], ensure_ascii=False) if q["whole_fruits"] else "—"
            half_fruits_str = json.dumps(q["half_fruits"], ensure_ascii=False) if q["half_fruits"] else "—"
            explanation_str = q["explanation"] if q["explanation"] else "—"

            analysis_blocks.append(f"""* **{cat_title} (`{m_name}`):**
  - **Точность расчетов:** Общее число целых: **{whole_display}** (эталон: 5), половинок: **{half_display}** (эталон: 1).
  - **Детализация фруктов:**
    - Целые: `{whole_fruits_str}`
    - Половинки: `{half_fruits_str}`
  - **Пояснение модели:** *«{explanation_str}»*
  - **Соблюдение формата JSON:** Валидный JSON: **{'Да' if q['valid_json'] else 'Нет'}** | Без лишнего текста: **{'Да' if q['strict_format'] else 'Нет'}**.
  - **Выявленные замечания:**
{issues_text}
""")
        else:
            table_rows.append(
                f"| **{cat_title}** | `{m_name}` | {res.get('elapsed_time', 0)}с | — | — | — | 0 т/с | Ошибка API | — | {res.get('error')} |"
            )
            analysis_blocks.append(f"""* **{cat_title} (`{m_name}`):**
  - ❌ Ошибка выполнения запроса: {res.get('error')}
""")

    # Сравнение по трём критериям задания Дня 5
    report_content = f"""# 🔥 День 5. Версии моделей: Сравнительный анализ (Week 1, Task 5)

Эксперимент по сравнению трёх категорий моделей искусственного интеллекта на **Groq API** на многошаговой логико-арифметической задаче с требованием строгого вывода в формате **JSON** без постороннего текста при `temperature = 0.0`.

---

## 🎯 Тестовый промпт
```text
{prompt.strip()}
```

---

## 📊 1. Сводная таблица замеров (Задание Дня 5)

| Категория модели | Имя модели | Время ответа | Prompt токенов | Completion токенов | Всего токенов | Скорость (ток/с) | Валидность JSON | Формат (без обёрток) | Результат расчёта |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
{chr(10).join(table_rows)}

---

## 🧠 Аналитическое решение задачи (Эталон)

1. **Исходное состояние в корзине:**
   - Яблоки: $4$ шт.
   - Апельсины: $2$ шт.
2. **Шаг 1: «Я съел одно яблоко»**
   - Яблоки: $4 - 1 = 3$ целых
   - Апельсины: $2$ целых
3. **Шаг 2: «Разрезал один апельсин пополам и отдал половину другу»**
   - Целые апельсины: $2 - 1 = 1$ целый
   - Половинки апельсинов: $2 - 1 = 1$ половинка (вторая отдана другу)
4. **Шаг 3: «Одно яблоко я обменял на две груши»**
   - Яблоки: $3 - 1 = 2$ целых
   - Груши: $+2$ целых
5. **Итоговый правильный баланс:**
   - **Целые фрукты:** $2 \\text{{ (яблока)}} + 1 \\text{{ (апельсин)}} + 2 \\text{{ (груши)}} = \\mathbf{{5}}$
   - **Половинки:** $\\mathbf{{1}}$ (половинка апельсина)
   - **Формат:** Чистый JSON-объект без обёрток ` ```json ` и вводного текста.

---

## 🔍 2. Сравнительный анализ по критериям задания

### 1. Качество ответов (Quality & Instruction Following)
{chr(10).join(analysis_blocks)}

### 2. Скорость ответа (Latency & Throughput)
* **Процессоры Groq LPU (Language Processing Unit):**
  - Благодаря тензорной потоковой архитектуре TSP и оперативной памяти SRAM чипы Groq обеспечивают аппаратную скорость генерации в сотни токенов в секунду.
  - Детерминированный режим (`temperature = 0.0`) минимизирует дисперсию времени генерации (jitter) и задержку до первого токена (TTFT).

### 3. Ресурсоёмкость (Tokens & Resource Efficiency)
* **Эффективность генерации:**
  - Строго структурированный промпт с ограничением на пояснение («1 предложение») позволяет всем моделям уложиться в минимальный диапазон токенов (~100–300 токенов на ответ).
  - Сравнение моделей показывает, насколько дисциплинированно класс модели соблюдает лимиты и не генерирует избыточных паразитных токенов.

---

## 📜 3. Полные ответы моделей

### 🔹 1. Слабая модель: `{results.get('weak', {}).get('model')}`
```text
{results.get('weak', {}).get('content', 'Ошибка или нет ответа')}
```

---

### 🔹 2. Средняя модель: `{results.get('medium', {}).get('model')}`
```text
{results.get('medium', {}).get('content', 'Ошибка или нет ответа')}
```

---

### 🔹 3. Сильная модель: `{results.get('strong', {}).get('model')}`
```text
{results.get('strong', {}).get('content', 'Ошибка или нет ответа')}
```
"""

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(report_content)
    print(f"\n[Успешно] Полный сравнительный отчёт сохранён в файл: {filepath}")


def main():
    parser = argparse.ArgumentParser(
        description="🔥 День 5. Версии моделей через Groq API: Сравнение слабой, средней и сильной LLM на логической задаче с JSON"
    )
    parser.add_argument("--weak", type=str, default=DEFAULT_MODELS["weak"], help="Имя слабой модели на Groq")
    parser.add_argument("--medium", type=str, default=DEFAULT_MODELS["medium"], help="Имя средней модели на Groq")
    parser.add_argument("--strong", type=str, default=DEFAULT_MODELS["strong"], help="Имя сильной модели на Groq")
    parser.add_argument("--prompt", type=str, default=DEFAULT_PROMPT, help="Пользовательский промпт")
    parser.add_argument("--temperature", type=float, default=0.0, help="Температура генерации (по умолчанию 0.0)")
    parser.add_argument("--no-save", action="store_true", help="Не сохранять отчет в results.md")
    parser.add_argument("--output", type=str, default="results.md", help="Имя файла для отчета markdown")
    args = parser.parse_args()

    api_key = get_api_key()

    models = {
        "weak": args.weak,
        "medium": args.medium,
        "strong": args.strong,
    }

    print("=" * 96)
    print("      🔥 ДЕНЬ 5. ЭКСПЕРИМЕНТ: СРАВНЕНИЕ МОДЕЛЕЙ ЧЕРЕЗ GROQ API (LPU ACCELERATION)")
    print("=" * 96)
    print(f"1. Слабая модель  : {models['weak']}")
    print(f"2. Средняя модель : {models['medium']}")
    print(f"3. Сильная модель : {models['strong']}")
    print(f"Параметр декодирования: temperature = {args.temperature}")
    print("-" * 96)
    print("Задача: Логический расчет корзины фруктов со строгим выводом в JSON")
    print("=" * 96 + "\n")

    results = {}

    order = [
        ("weak", "1/3. Запрос к СЛАБОЙ модели"),
        ("medium", "2/3. Запрос к СРЕДНЕЙ модели"),
        ("strong", "3/3. Запрос к СИЛЬНОЙ модели"),
    ]

    for key, label in order:
        model_name = models[key]
        print(f"\n>>> [{label}]: {model_name}...")
        res = call_model(
            model_name=model_name,
            prompt=args.prompt,
            api_key=api_key,
            temperature=args.temperature
        )
        res["model"] = model_name
        results[key] = res

        if res["success"]:
            q = analyze_solution_quality(res["content"])
            print(f"    ✔ Завершено за {res['elapsed_time']}с | Токенов: {res['total_tokens']} (In: {res['prompt_tokens']}, Out: {res['completion_tokens']}) | Скорость: {res['throughput']} ток/с")
            print(f"    📌 Оценка: {q['status']}")
        else:
            print(f"    ✖ Ошибка: {res['error']} (время: {res['elapsed_time']}с)")

    # Вывод сравнительной таблицы в консоль
    print_summary_table(results)

    # Сохранение отчета
    if not args.no_save:
        generate_markdown_report(results, prompt=args.prompt, filename=args.output)


if __name__ == "__main__":
    main()
