import unittest
from unittest.mock import patch, MagicMock
from main import ask_llm


class TestOpenRouterClient(unittest.TestCase):
    @patch("main.requests.post")
    def test_ask_llm_success(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [
                {"message": {"content": "Привет! Я тестовая LLM модель."}}
            ]
        }
        mock_post.return_value = mock_response

        response = ask_llm(
            prompt="Привет!",
            model="minimax/minimax-m3:free",
            api_key="test-key"
        )
        self.assertEqual(response, "Привет! Я тестовая LLM модель.")

    @patch("main.requests.post")
    def test_ask_llm_api_error(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_response.json.return_value = {
            "error": {"message": "Invalid API Key"}
        }
        mock_post.return_value = mock_response

        response = ask_llm(
            prompt="Тест",
            model="minimax/minimax-m3:free",
            api_key="bad-key"
        )
        self.assertIn("Ошибка API 401", response)
        self.assertIn("Invalid API Key", response)


if __name__ == "__main__":
    unittest.main()
