import os
import sys
import requests
from dotenv import load_dotenv

# Обеспечиваем корректный вывод UTF-8 в консоли Windows
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Загружаем переменные окружения из .env файла
# Ищем .env в директории скрипта и в текущей рабочей директории
script_dir = os.path.dirname(os.path.abspath(__file__))
dotenv_path = os.path.join(script_dir, ".env")
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)
else:
    load_dotenv()

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "minimax/minimax-m3:free"


def get_config():
    """Получение и валидация конфигурации из переменных окружения."""
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    model = os.getenv("OPENROUTER_MODEL", "").strip() or DEFAULT_MODEL

    if not api_key or api_key == "your_openrouter_api_key_here":
        print("\n[ОШИБКА] API-ключ OpenRouter не найден или не настроен!")
        print("Пожалуйста, создайте файл .env в папке week1/task1 со следующим содержимым:")
        print("  OPENROUTER_API_KEY=sk-or-v1-ваш-ключ")
        print(f"  OPENROUTER_MODEL={model}")
        print("\n(Шаблон доступен в файле .env.example)\n")
        sys.exit(1)

    return api_key, model


def ask_llm(prompt: str, model: str, api_key: str) -> str:
    """
    Отправляет запрос к модели через OpenRouter API и возвращает текст ответа.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/ai-advent-challenge",
        "X-Title": "AI Advent Challenge Task 1",
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
    }

    try:
        response = requests.post(
            OPENROUTER_API_URL,
            headers=headers,
            json=payload,
            timeout=60
        )

        # Проверка HTTP-статуса
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


def main():
    api_key, model = get_config()

    print("=" * 55)
    print("      OpenRouter LLM CLI Client (Task 1)")
    print("=" * 55)
    print(f"Модель: {model}")
    print("Введите ваш вопрос к LLM.")
    print("Для завершения работы введите 'exit', 'quit' или нажмите Ctrl+C.\n")

    while True:
        try:
            user_input = input("Вы: ").strip()

            if not user_input:
                continue

            if user_input.lower() in ("exit", "quit", "q"):
                print("Завершение сеанса. До свидания!")
                break

            print("\n[Запрос отправлен, ожидание ответа...]")
            reply = ask_llm(prompt=user_input, model=model, api_key=api_key)
            print(f"\nLLM:\n{reply}\n")
            print("-" * 55)

        except KeyboardInterrupt:
            print("\n\nПрервано пользователем. Выход...")
            break
        except EOFError:
            break


if __name__ == "__main__":
    main()
