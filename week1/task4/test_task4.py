import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from main import ask_llm, save_report_to_markdown, DEFAULT_PROMPT, TEMPERATURES


class TestTask4(unittest.TestCase):
    @patch("main.requests.post")
    def test_ask_llm_success(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [
                {"message": {"content": "Тестовый ответ"}}
            ]
        }
        mock_post.return_value = mock_response

        reply = ask_llm(prompt=DEFAULT_PROMPT, temperature=0.7, model="test-model", api_key="test-key")
        self.assertEqual(reply, "Тестовый ответ")
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs["json"]["temperature"], 0.7)
        self.assertEqual(kwargs["json"]["model"], "test-model")

    def test_save_report_to_markdown(self):
        test_filename = "test_results.md"
        test_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), test_filename)
        sample_results = {
            0.0: "Ответ 0.0",
            0.7: "Ответ 0.7",
            1.2: "Ответ 1.2"
        }
        try:
            save_report_to_markdown(model="test-model", prompt=DEFAULT_PROMPT, results=sample_results, filename=test_filename)
            self.assertTrue(os.path.exists(test_path))
            with open(test_path, "r", encoding="utf-8") as f:
                content = f.read()
            self.assertIn("Ответ 0.0", content)
            self.assertIn("Ответ 0.7", content)
            self.assertIn("Ответ 1.2", content)
            self.assertIn("test-model", content)
        finally:
            if os.path.exists(test_path):
                os.remove(test_path)


if __name__ == "__main__":
    unittest.main()
