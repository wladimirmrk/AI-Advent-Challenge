import os
import sys
import time
import requests
from dotenv import load_dotenv

# Настройка корректного вывода UTF-8 в консоли Windows
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Поиск и загрузка .env файла (в текущей папке или в соседних/родительских)
current_dir = os.path.dirname(os.path.abspath(__file__))
dotenv_candidates = [
    os.path.join(current_dir, ".env"),
    os.path.join(current_dir, "..", "task2", ".env"),
    os.path.join(current_dir, "..", "task1", ".env"),
    os.path.join(current_dir, "..", "..", ".env"),
]

for env_path in dotenv_candidates:
    if os.path.exists(env_path):
        load_dotenv(dotenv_path=env_path)
        break

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "minimax/minimax-m3:free"

# Компактная логическая задача на переправу
TASK_PROBLEM = (
    "Крестьянину нужно перевезти через реку волка, козу и капусту. "
    "В лодке помещается только сам крестьянин и с ним один объект (или волк, или коза, или капуста). "
    "Нельзя оставлять без присмотра крестьянина волка с козой или козу с капустой. "
    "Как крестьянину перевезти всех на другой берег за минимальное число переправ? "
    "Приведи полный пошаговый план каждого рейса туда и обратно."
)


def get_config():
    """Получение и проверка API ключа и модели."""
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    model = os.getenv("OPENROUTER_MODEL", "").strip() or DEFAULT_MODEL

    if not api_key or api_key == "your_openrouter_api_key_here":
        print("\n[ОШИБКА] API-ключ OpenRouter не найден или не настроен!")
        print("Пожалуйста, укажите валидный OPENROUTER_API_KEY в файле .env")
        sys.exit(1)

    return api_key, model


def call_llm(messages: list, model: str, api_key: str, temperature: float = 0.5) -> str:
    """Отправка запроса к OpenRouter API."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/ai-advent-challenge",
        "X-Title": "AI Advent Challenge Task 3",
    }

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }

    try:
        response = requests.post(
            OPENROUTER_API_URL,
            headers=headers,
            json=payload,
            timeout=90
        )

        if response.status_code != 200:
            try:
                err_json = response.json()
                msg = err_json.get("error", {}).get("message", response.text)
            except Exception:
                msg = response.text
            return f"[Ошибка API {response.status_code}]: {msg}"

        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            return "[Ошибка]: Получен пустой ответ от модели."

        return choices[0].get("message", {}).get("content", "").strip()

    except requests.exceptions.Timeout:
        return "[Ошибка]: Время ожидания ответа от OpenRouter истекло (таймаут 90с)."
    except requests.exceptions.ConnectionError:
        return "[Ошибка]: Не удалось установить соединение с сервером OpenRouter."
    except requests.exceptions.RequestException as e:
        return f"[Сетевая ошибка]: {e}"


def solve_method_1_direct(task: str, model: str, api_key: str) -> str:
    """Способ 1: Прямой ответ без дополнительных инструкций."""
    messages = [{"role": "user", "content": task}]
    return call_llm(messages, model, api_key)


def solve_method_2_cot(task: str, model: str, api_key: str) -> str:
    """Способ 2: Пошаговое рассуждение (Chain of Thought)."""
    prompt = f"{task}\n\nРешай пошагово. Распиши подробно каждый шаг и логику рассуждений."
    messages = [{"role": "user", "content": prompt}]
    return call_llm(messages, model, api_key)


def solve_method_3_meta_prompt(task: str, model: str, api_key: str) -> tuple[str, str]:
    """
    Способ 3: Мета-промптинг.
    1 этап: Модель составляет оптимизированный промпт.
    2 этап: Решение задачи с использованием сгенерированного промпта.
    """
    prompt_for_prompt = (
        "Ты — опытный инженер промптов (Prompt Engineer). "
        "Составь подробный, ясный и эффективный промпт для большой языковой модели, "
        "чтобы она гарантированно и без логических ошибок решила следующую задачу на переправу:\n\n"
        f"«{task}»\n\n"
        "Промпт должен четко требовать проверки безопасности берегов на каждом шаге. "
        "Выведи ТОЛЬКО текст составленного промпта без лишних вступлений."
    )

    generated_prompt = call_llm([{"role": "user", "content": prompt_for_prompt}], model, api_key)

    # Решаем задачу с помощью составленного промпта
    solution = call_llm([{"role": "user", "content": generated_prompt}], model, api_key)
    return generated_prompt, solution


def solve_method_4_expert_group(task: str, model: str, api_key: str) -> str:
    """Способ 4: Группа экспертов (Multi-Persona)."""
    expert_prompt = (
        f"Задача для решения:\n{task}\n\n"
        "Для решения задачи сформируй консилиум из трех экспертов:\n\n"
        "1. Аналитик (Constraints & State Analysis):\n"
        "   - Выделяет допустимые и запрещенные пары состояний на берегах.\n"
        "   - Объясняет, почему ключевым объектом является коза.\n\n"
        "2. Инженер (Step-by-step Route Planner):\n"
        "   - Строит точный план переправ каждого рейса (туда и обратно) с фиксацией состояния обоих берегов.\n\n"
        "3. Критик (Safety Reviewer):\n"
        "   - Проверяет безопасность каждого берега на каждом шаге (никто никого не съедает).\n"
        "   - Подтверждает минимальность количества рейсов.\n\n"
        "Выведи структурированный ответ: позицию каждого эксперта по очереди, а в конце сформулируй общий консенсус и итоговый план."
    )
    messages = [{"role": "user", "content": expert_prompt}]
    return call_llm(messages, model, api_key)


def print_separator(title: str = "", char: str = "=", length: int = 70):
    if title:
        padding = max(0, (length - len(title) - 2) // 2)
        print(f"\n{char * padding} {title} {char * padding}")
    else:
        print(f"\n{char * length}")


def main():
    api_key, model = get_config()

    print_separator("ДЕНЬ 3: РАЗНЫЕ СПОСОБЫ РАССУЖДЕНИЯ", "=")
    print(f"Используемая модель: {model}")
    print("\nИсследуемая задача (Волк, коза и капуста):")
    print(f"«{TASK_PROBLEM}»")
    print_separator("", "-")

    # 1. Прямой ответ
    print("\n[1/4] Выполняется Способ 1: Прямой ответ без дополнительных инструкций...")
    start_t = time.time()
    ans1 = solve_method_1_direct(TASK_PROBLEM, model, api_key)
    print(f"✓ Завершено за {time.time() - start_t:.1f} сек.")

    # 2. Пошагово (CoT)
    print("\n[2/4] Выполняется Способ 2: Пошаговое рассуждение («решай пошагово»)...")
    start_t = time.time()
    ans2 = solve_method_2_cot(TASK_PROBLEM, model, api_key)
    print(f"✓ Завершено за {time.time() - start_t:.1f} сек.")

    # 3. Мета-промптинг (сначала промпт, затем решение)
    print("\n[3/4] Выполняется Способ 3: Мета-промптинг (генерация промпта -> решение)...")
    start_t = time.time()
    gen_prompt, ans3 = solve_method_3_meta_prompt(TASK_PROBLEM, model, api_key)
    print(f"✓ Завершено за {time.time() - start_t:.1f} сек.")

    # 4. Группа экспертов
    print("\n[4/4] Выполняется Способ 4: Группа экспертов (Аналитик, Инженер, Критик)...")
    start_t = time.time()
    ans4 = solve_method_4_expert_group(TASK_PROBLEM, model, api_key)
    print(f"✓ Завершено за {time.time() - start_t:.1f} сек.")

    # Вывод результатов
    print_separator("РЕЗУЛЬТАТЫ РЕШЕНИЙ ДЛЯ СРАВНЕНИЯ", "█")

    print_separator("СПОСОБ 1: ПРЯМОЙ ОТВЕТ", "#")
    print(ans1)

    print_separator("СПОСОБ 2: ПОШАГОВОЕ РАССУЖДЕНИЕ («РЕШАЙ ПОШАГОВО»)", "#")
    print(ans2)

    print_separator("СПОСОБ 3: МЕТА-ПРОМПТИНГ", "#")
    print("\n--- [Сгенерированный моделью промпт] ---")
    print(gen_prompt)
    print("\n--- [Решение по сгенерированному промпту] ---")
    print(ans3)

    print_separator("СПОСОБ 4: ГРУППА ЭКСПЕРТОВ (АНАЛИТИК, ИНЖЕНЕР, КРИТИК)", "#")
    print(ans4)

    # Итоговый чек-лист для сравнения пользователем
    print_separator("КРИТЕРИИ ДЛЯ ВАШЕГО СРАВНЕНИЯ", "=")
    print("При анализе полученных ответов обратите внимание на следующие моменты:")
    print(" 1. Количество переправ: Классическое минимальное число рейсов равно 7 (4 туда, 3 обратно).")
    print(" 2. Ключевой нетривиальный маневр: Догадалась ли модель забрать козу обратно на шаге 4?")
    print(" 3. Проверка безопасности: Описано ли состояние берегов после каждого шага?")
    print(" 4. Различия в подаче: Как различается стиль и глубина между прямым ответом и экспертами?")
    print_separator("", "=")


if __name__ == "__main__":
    main()
