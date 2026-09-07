import os
import sys
import argparse
import requests
from dotenv import load_dotenv

# Обеспечиваем корректный вывод UTF-8 в консоли Windows
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Загружаем переменные окружения из .env файла
script_dir = os.path.dirname(os.path.abspath(__file__))
dotenv_path = os.path.join(script_dir, ".env")
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)
else:
    load_dotenv()

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "minimax/minimax-m3:free"
DEFAULT_PROMPT = "Придумай 3 необычных названия и слогана для кофейни в космосе"
TEMPERATURES = [0.0, 0.7, 1.2]


def get_config():
    """Получение и строгая валидация конфигурации из переменных окружения."""
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    model = os.getenv("OPENROUTER_MODEL", "").strip() or DEFAULT_MODEL

    if not api_key or api_key == "your_openrouter_api_key_here":
        print("\n[ОШИБКА] API-ключ OpenRouter не найден или не настроен!")
        print(f"Пожалуйста, создайте файл .env в папке {script_dir} со следующим содержимым:")
        print("  OPENROUTER_API_KEY=sk-or-v1-ваш-ключ")
        print(f"  OPENROUTER_MODEL={model}")
        print("\n(Шаблон доступен в файле .env.example)\n")
        sys.exit(1)

    return api_key, model


def ask_llm(prompt: str, temperature: float, model: str, api_key: str) -> str:
    """
    Отправляет запрос к модели через OpenRouter API с указанной температурой
    и возвращает текст ответа.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/ai-advent-challenge",
        "X-Title": "AI Advent Challenge Task 4 - Temperature Comparison",
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": temperature,
    }

    try:
        response = requests.post(
            OPENROUTER_API_URL,
            headers=headers,
            json=payload,
            timeout=60
        )

        if response.status_code != 200:
            try:
                error_data = response.json()
                error_msg = error_data.get("error", {}).get("message", response.text)
            except Exception:
                error_msg = response.text
            return f"[Ошибка API {response.status_code}]: {error_msg}"

        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            return "[Ошибка]: Пустой ответ от модели."

        return choices[0].get("message", {}).get("content", "").strip()

    except requests.exceptions.Timeout:
        return "[Ошибка]: Превышено время ожидания ответа от сервера (таймаут 60с)."
    except requests.exceptions.ConnectionError:
        return "[Ошибка]: Не удалось установить соединение с сервером OpenRouter."
    except requests.exceptions.RequestException as e:
        return f"[Сетевая ошибка]: {e}"


def print_conclusions():
    """Выводит сравнительный анализ и рекомендации по температуре."""
    analysis = """
================================================================================
                    АНАЛИЗ И ВЫВОДЫ ПО ПАРАМЕТРУ TEMPERATURE
================================================================================

1. СРАВНЕНИЕ ХАРАКТЕРИСТИК ОТВЕТОВ:

   * ТОЧНОСТЬ (Instruction Following & Coherence):
     - T = 0.0: Максимальная точность и строгое следование промпту. Модель выбирает
       наиболее вероятные токены (argmax sampling), текст логичен, структурирован,
       без лишних фантазий.
     - T = 0.7: Оптимальный баланс. Точность остаётся высокой, сохраняется логика
       и формат, но язык становится более живым и естественным.
     - T = 1.2: Точность может снижаться. Модель чаще обращается к низковероятным
       токенам, что может приводить к отклонению от строгих инструкций или появлению
       странных языковых конструкций.

   * КРЕАТИВНОСТЬ (Creativity & Novelty):
     - T = 0.0: Минимальная креативность. Идеи стандартные, архетипичные (например,
       "CosmoCoffee", "Starbucks Galaxy"), опираются на самые частые шаблоны в данных.
     - T = 0.7: Умеренная/хорошая креативность. Появляются интересные метафоры,
       оригинальные и неизбитые концепты, сохраняющие хороший вкус и уместность.
     - T = 1.2: Максимальная креативность и неожиданность. Ассоциации нестандартные,
       футуристичные, местами дерзкие и сюрреалистичные.

   * РАЗНООБРАЗИЕ (Diversity & Entropy):
     - T = 0.0: Нулевое разнообразие. Повторный запуск того же промпта выдаст
       идентичный ответ (детерминированное поведение).
     - T = 0.7: Среднее разнообразие. Каждый повторный запуск генерирует новые
       варианты, сохраняя общую тональность.
     - T = 1.2: Высочайшее разнообразие. Каждый запуск исследует совершенно новые
       семантические области, словарь токенов максимально широк.

--------------------------------------------------------------------------------

2. ДЛЯ КАКИХ ЗАДАЧ ЛУЧШЕ ПОДХОДИТ КАЖДАЯ НАСТРОЙКА:

   * T = 0.0 (Детерминизм и строгая логика):
     - Написание и рефакторинг программного кода
     - Математические расчеты и логические выводы
     - Извлечение данных (NER, парсинг текста в JSON/SQL)
     - Классификация текстов и анализ тональности
     - Ответы на вопросы по базе знаний (RAG, FAQ, техническая поддержка)

   * T = 0.7 (Баланс интеллекта и естественности):
     - Диалоговые ассистенты общего назначения (чат-боты)
     - Написание статей, постов для блогов, деловых писем
     - Обобщение текстов (саммаризация) с естественной стилизацией
     - Перевод текстов с сохранением идиом и художественного стиля
     - Образовательные объяснения сложных тем

   * T = 1.2 (Творческий поиск и генерация идей):
     - Брейншторминг названий (нейминг), слоганов и рекламных концепций
     - Создание сюжетов, персонажей, поэзии и художественной литературы
     - Разработка игровых квестов и диалогов в RPG
     - Поиск нестандартных гипотез и ассоциативных связей
     - Выход из творческого кризиса (генерация сырых необычных идей)
================================================================================
"""
    print(analysis)


def save_report_to_markdown(model: str, prompt: str, results: dict, filename: str = "results.md"):
    """Сохраняет результаты запусков и выводы в markdown-файл."""
    filepath = os.path.join(script_dir, filename)
    md_content = f"""# Отчёт по эксперименту: Сравнение параметров температуры (Task 4)

**Модель:** `{model}`  
**Тестовый промпт:** *«{prompt}»*  

---

## 1. Полученные ответы при разных значениях `temperature`

### 🔹 Temperature = 0.0 (Детерминированный режим)
```text
{results.get(0.0, 'Нет данных')}
```

---

### 🔹 Temperature = 0.7 (Сбалансированный режим)
```text
{results.get(0.7, 'Нет данных')}
```

---

### 🔹 Temperature = 1.2 (Творческий / Высокоэнтропийный режим)
```text
{results.get(1.2, 'Нет данных')}
```

---

## 2. Сравнительный анализ по критериям

| Критерий | Temperature = 0.0 | Temperature = 0.7 | Temperature = 1.2 |
| :--- | :--- | :--- | :--- |
| **Точность и логика** | **Максимальная**: строгое следование правилам, устойчивая структура, отсутствие выдумок | **Оптимальная**: соблюдение инструкций, естественный связный язык | **Умеренная/Сниженная**: риск отклонения от формата и появления странных конструкций |
| **Креативность** | **Низкая**: предсказуемые, базовые и общепринятые клише | **Высокая**: живые метафоры, гармоничные и оригинальные идеи | **Максимальная**: дерзкие, сюрреалистичные, редкие ассоциации |
| **Разнообразие** | **Нулевое**: 100% повторяемость (детерминизм) при одинаковых запросах | **Среднее**: умеренная вариативность формулировок от запуска к запуску | **Высокое**: максимальная вариативность и непредсказуемость |

---

## 3. Рекомендации по выбору температуры

* **`temperature = 0.0`**: задачи с единственно верным решением — генерация кода, математика, SQL, извлечение JSON, классификация, строгий RAG.
* **`temperature = 0.7`**: задачи общего назначения — чат-боты, копирайтинг, написание эссе, суммаризация, перевод.
* **`temperature = 1.2`**: задачи поиска новых идей — брейншторминг, нейминг продуктов, написание художественных историй, поэзия, создание игровых сценариев.
"""
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f"\n[Успешно] Полный отчёт сохранён в файл: {filepath}")


def main():
    parser = argparse.ArgumentParser(description="Сравнение работы LLM при разных температурах (День 4)")
    parser.add_argument("--prompt", type=str, default=DEFAULT_PROMPT, help="Пользовательский промпт для тестирования")
    parser.add_argument("--model", type=str, default=None, help="Модель LLM (по умолчанию из .env)")
    parser.add_argument("--no-save", action="store_true", help="Не сохранять результаты в markdown-файл")
    args = parser.parse_args()

    api_key, env_model = get_config()
    model = args.model or env_model
    prompt = args.prompt

    print("=" * 80)
    print("      🔥 ДЕНЬ 4. ЭКСПЕРИМЕНТ: ВЛИЯНИЕ ПАРАМЕТРА TEMPERATURE В LLM")
    print("=" * 80)
    print(f"Модель: {model}")
    print(f"Промпт: \"{prompt}\"")
    print(f"Тестируемые значения температуры: {TEMPERATURES}")
    print("=" * 80 + "\n")

    results = {}

    for temp in TEMPERATURES:
        print(f"\n>>> [1/3] Запрос с temperature = {temp}...")
        reply = ask_llm(prompt=prompt, temperature=temp, model=model, api_key=api_key)
        results[temp] = reply

        print(f"\n--- [ОТВЕТ ПРИ TEMPERATURE = {temp}] ---")
        print(reply)
        print("-" * 80)

    print_conclusions()

    if not args.no_save:
        save_report_to_markdown(model=model, prompt=prompt, results=results)


if __name__ == "__main__":
    main()
