import os
import sys
import requests
from dotenv import load_dotenv

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Загрузка переменных окружения из собственного .env файла
dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(dotenv_path=dotenv_path)

api_key = os.getenv("OPENROUTER_API_KEY")
model = os.getenv("OPENROUTER_MODEL", "minimax/minimax-m3:free")
url = "https://openrouter.ai/api/v1/chat/completions"
headers = {"Authorization": f"Bearer {api_key}"}

base_prompt = "Расскажи о планете Марс."

# 1. Запрос без ограничений
res1 = requests.post(
    url,
    headers=headers,
    json={
        "model": model,
        "messages": [{"role": "user", "content": base_prompt}],
    },
)
answer1 = res1.json()["choices"][0]["message"]["content"]

# 2. Запрос с ограничениями (формат JSON, лимит токенов, stop sequence)
res2 = requests.post(
    url,
    headers=headers,
    json={
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": f"{base_prompt} Ответь строго в формате JSON: {{\"planet\": \"Марс\", \"facts\": [...]}}. Заверши вывод символом }}",
            }
        ],
        "max_tokens": 100,
        "stop": ["}"],
    },
)
answer2 = res2.json()["choices"][0]["message"]["content"]

# Вывод результатов для сравнения
print("=== Без ограничений ===")
print(answer1)
print("\n=== С ограничениями ===")
print(answer2)
