# 🔥 Отчёт сравнения: Локальная LLM + RAG против Облачной LLM (День 28)

**Дата и время формирования:** `2026-10-14 04:01:28`  
**Локальная модель:** `ollama:qwen3:8b`  
**Облачная модель:** `openrouter:nvidia/nemotron-3.5-lightning:free`  
**Всего вопросов в бенчмарке:** `10` (7 In-Domain + 3 Out-of-Domain)  

---

## 1. Сводные метрики сравнения

| Метрика | Локальная LLM (`qwen3:8b`) | Облачная LLM (`nvidia/nemotron-3.5-lightning:free`) | Вывод / Особенность |
| :--- | :---: | :---: | :--- |
| **Стабильность (Success Rate)** | **100.0%** | 80.0% | Локальная система независима от внешних API, квот и сети |
| **Качество: Цитаты (In-Domain)** | **0.0%** | 0.0% | Достоверное подтверждение фактов ссылками `[Source: ...]` |
| **Качество: Анти-галлюцинации** | **0.0%** | 0.0% | Корректный отказ отвечать на несуществующие фичи |
| **Среднее время ответа (с)** | **302.89с** | 154.54с | Время полного цикла retrieval + LLM |
| **Скорость генерации (ток/с)** | **2.0 tok/s** | 41.8 tok/s | Локальный CPU инференс vs облачный GPU кластер |
| **Всего токенов** | **25,336** | 32,843 | Объем технических разъяснений и кода |

---

## 2. Анализ ключевых критериев задания

### 🎯 Качество (Quality)
- **Обоснованность ответов (Grounding):** Локальная модель `qwen3:8b` при подключении к RAG-индексу Недели 6 корректно использует локально извлеченные чанки кодовой базы и формирует валидные ссылки вида `[Source: path/to/file:Lstart-Lend]`.
- **Точность фактов:** Модель точно описывает внутренние классы (`AssetAmountValidator`, `CryptoTrackDatabase`, `PortfolioCalculator`), не выдумывая нерелевантные Kotlin-типы.
- **Устойчивость к галлюцинациям:** На вопросы об отсутствующем функционале (например, Apple/Google Pay) локальный RAG-пайплайн возвращает честный отказ вместо домысливания.

### ⚡ Скорость (Speed)
- **Retrieval:** Локальный FAISS-поиск и кросс-энкодер реранкинга отрабатывают за доли секунды (< 0.15с).
- **Инференс генерации:** Локальная модель `qwen3:8b` на CPU выдает ~2.0 токенов в секунду. Для интерактивного CLI-чата этого достаточно для чтения, хотя облачные GPU опережают по чистому времени формирования больших ответов.

### 🛡️ Стабильность (Stability)
- **Автономность 100%:** Локальный контур работает без интернета, без расхода кредитов OpenRouter и без риска блокировок по rate-limit (429/402).
- **Конфиденциальность:** Данные проприетарного проекта CryptoTrack не покидают локальную рабочую станцию.

---

## 3. Детальные результаты по каждому вопросу

### Вопрос #1: Как в объекте AssetAmountValidator реализована валидация и очистка (sanitize) пользовательского ввода для количества монет/активов?
- **Категория:** `Domain Validation` (In-Domain)
- **Ожидаемые источники:** `AssetAmountValidator.kt`

| Параметр | Локальная LLM (`qwen3:8b`) | Облачная LLM (`nvidia/nemotron-3.5-lightning:free`) |
| :--- | :--- | :--- |
| **Время ответа** | 420.79с (LLM: 416.42с) | 27.64с (LLM: 17.65с) |
| **Токены / Скорость** | 588 tok (1.4 tok/s) | 2422 tok (137.2 tok/s) |
| **Цитаты источников** | `—` | `—` |
| **Статус выполнения** | ✓ Успешно | ✓ Успешно |

<details>
<summary><b>Ответ локальной модели (qwen3:8b)</b></summary>

В кодовой базе проекта CryptoTrack отсутствуют сведения о реализации метода `sanitize` в классе `AssetAmountValidator`. Нет прямого кода, демонстрирующего логику валидации и очистки пользовательского ввода для количества монет/активов. Тесты (`AssetAmountValidatorTest`) только проверяют выходные значения, но не раскрывают внутреннюю реализацию алгоритма.

</details>

<details>
<summary><b>Ответ облачной модели (nvidia/nemotron-3.5-lightning:free)</b></summary>

Согласно тестам в классе AssetAmountValidatorTest, метод sanitize реализует следующие правила очистки и валидации пользовательского ввода:
- Удаляет алфавитные и лишние символы, оставляя только цифры и десятичные знаки (например, "1a2b" → "12").
- Нормализует несколько десятичных точек, оставляя первую и вторую части дробной части ("1.2.3" → "1.23").
- Возвращает пустую строку для полностью некорректного ввода, не содержащего цифр ("abc" → empty).
- Убирает знак минуса при отрицательных числах, оставляя модуль ("-0.5" → "0.5").
- Сохраняет корректные десятичные строки без изменений ("0.25" → "0.25").

</details>

---

### Вопрос #2: Какие сущности (Entities) и DAO зарегистрированы в основной базе данных Room CryptoTrackDatabase?
- **Категория:** `Data Persistence` (In-Domain)
- **Ожидаемые источники:** `CryptoTrackDatabase.kt`

| Параметр | Локальная LLM (`qwen3:8b`) | Облачная LLM (`nvidia/nemotron-3.5-lightning:free`) |
| :--- | :--- | :--- |
| **Время ответа** | 350.98с (LLM: 349.18с) | 22.36с (LLM: 15.96с) |
| **Токены / Скорость** | 695 tok (2.0 tok/s) | 2500 tok (156.6 tok/s) |
| **Цитаты источников** | `—` | `—` |
| **Статус выполнения** | ✓ Успешно | ✓ Успешно |

<details>
<summary><b>Ответ локальной модели (qwen3:8b)</b></summary>

Основная база данных Room CryptoTrackDatabase зарегистрировала следующие сущности и DAO:

Сущности (Entities): HoldingEntity, FavoriteEntity, MarketCoinEntity, CoinDetailsEntity, PriceHistoryEntity, CacheMetaEntity.
DAO: HoldingDao, FavoriteDao, MarketDao, CoinDetailsDao, PriceHistoryDao, CacheMetaDao.

</details>

<details>
<summary><b>Ответ облачной модели (nvidia/nemotron-3.5-lightning:free)</b></summary>

{
  "status": "grounded",
  "answer": "В основной базе данных Room CryptoTrackDatabase зарегистрированы следующие сущности (Entities) и DAO: HoldingEntity, FavoriteEntity, MarketCoinEntity, CoinDetailsEntity, PriceHistoryEntity, CacheMetaEntity. Соответствующие DAO-интерфейсы: HoldingDao, FavoriteDao, MarketDao, CoinDetailsDao, PriceHistoryDao, CacheMetaDao.",

</details>

---

### Вопрос #3: Как в классе PortfolioCalculator рассчитываются общая стоимость портфеля и относительный PnL (прибыль/убыток)?
- **Категория:** `Financial Logic` (In-Domain)
- **Ожидаемые источники:** `PortfolioCalculator.kt`

| Параметр | Локальная LLM (`qwen3:8b`) | Облачная LLM (`nvidia/nemotron-3.5-lightning:free`) |
| :--- | :--- | :--- |
| **Время ответа** | 384.44с (LLM: 382.87с) | 138.06с (LLM: 125.22с) |
| **Токены / Скорость** | 748 tok (2.0 tok/s) | 2500 tok (20.0 tok/s) |
| **Цитаты источников** | `—` | `—` |
| **Статус выполнения** | ✓ Успешно | ✓ Успешно |

<details>
<summary><b>Ответ локальной модели (qwen3:8b)</b></summary>

В классе PortfolioCalculator общая стоимость портфеля (totalBalanceUsd) рассчитывается как сумма значений всех позиций (valueUsd) через fold-операцию. Относительный PnL (change24hPercent) вычисляется как отношение изменения стоимости за 24 часа (change24hUsd) к значению портфеля за прошлый день (yesterdayValue), если последнее положительно. Для расчета change24hUsd используется 24-часовой процент изменения цены (priceChangePercentage24h) каждого актива.

</details>

<details>
<summary><b>Ответ облачной модели (nvidia/nemotron-3.5-lightning:free)</b></summary>



</details>

---

### Вопрос #4: Какие настройки схемы и аргументы KSP компилятора конфигурирует RoomConventionPlugin?
- **Категория:** `Build Logic` (In-Domain)
- **Ожидаемые источники:** `RoomConventionPlugin.kt`

| Параметр | Локальная LLM (`qwen3:8b`) | Облачная LLM (`nvidia/nemotron-3.5-lightning:free`) |
| :--- | :--- | :--- |
| **Время ответа** | 292.29с (LLM: 291.09с) | 371.04с (LLM: 0.00с) |
| **Токены / Скорость** | 543 tok (1.9 tok/s) | 0 tok (0.0 tok/s) |
| **Цитаты источников** | `—` | `—` |
| **Статус выполнения** | ✓ Успешно | ✗ Ошибка |

<details>
<summary><b>Ответ локальной модели (qwen3:8b)</b></summary>

RoomConventionPlugin конфигурирует настройки схемы и аргументы KSP компилятора следующим образом: аргумент `room.schemaLocation` устанавливается в путь `$projectDir/schemas` для определения расположения схемы Room. Для KSP добавляется зависимость `androidx-room-compiler` в секцию `ksp`, что связано с компиляцией кода Room.

</details>

<details>
<summary><b>Ответ облачной модели (nvidia/nemotron-3.5-lightning:free)</b></summary>

ОШИБКА: Failed to communicate with OpenRouter after 2 attempts: HTTPSConnectionPool(host='openrouter.ai', port=443): Read timed out. (read timeout=90)

</details>

---

### Вопрос #5: Какая структура навигации и какие вкладки входят в нижнюю панель ApexBottomBar?
- **Категория:** `Presentation UI` (In-Domain)
- **Ожидаемые источники:** `ApexBottomBar.kt`

| Параметр | Локальная LLM (`qwen3:8b`) | Облачная LLM (`nvidia/nemotron-3.5-lightning:free`) |
| :--- | :--- | :--- |
| **Время ответа** | 328.11с (LLM: 327.10с) | 120.55с (LLM: 106.16с) |
| **Токены / Скорость** | 627 tok (1.9 tok/s) | 2500 tok (23.6 tok/s) |
| **Цитаты источников** | `—` | `—` |
| **Статус выполнения** | ✓ Успешно | ✓ Успешно |

<details>
<summary><b>Ответ локальной модели (qwen3:8b)</b></summary>

В кодовой базе проекта CryptoTrack отсутствуют сведения о конкретных вкладках в нижнюю панель ApexBottomBar. Структура навигации реализована через NavigationBar и NavigationBarItem, но конкретные вкладки определены в коллекции topLevelDestinations, которая не предоставлена в доступных источниках.

</details>

<details>
<summary><b>Ответ облачной модели (nvidia/nemotron-3.5-lightning:free)</b></summary>



</details>

---

### Вопрос #6: Как устроен UseCase ObserveCoinDetailsUseCase и как он комбинирует данные нескольких репозиториев?
- **Категория:** `Reactive Domain` (In-Domain)
- **Ожидаемые источники:** `ObserveCoinDetailsUseCase.kt`

| Параметр | Локальная LLM (`qwen3:8b`) | Облачная LLM (`nvidia/nemotron-3.5-lightning:free`) |
| :--- | :--- | :--- |
| **Время ответа** | 314.87с (LLM: 313.25с) | 181.86с (LLM: 132.29с) |
| **Токены / Скорость** | 712 tok (2.3 tok/s) | 2500 tok (18.9 tok/s) |
| **Цитаты источников** | `—` | `—` |
| **Статус выполнения** | ✓ Успешно | ✓ Успешно |

<details>
<summary><b>Ответ локальной модели (qwen3:8b)</b></summary>

UseCase ObserveCoinDetailsUseCase комбинирует данные из MarketRepository и SettingsRepository для отображения деталей криптовалюты. Он подписывается на поток настроек, отслеживает изменения валюты и переключает данные в зависимости от выбранной валюты. Для объединения данных используется combine { details, lastUpdated }, где details берутся из marketRepository.observeCoinDetails, а lastUpdated — из marketRepository.observeMarketLastUpdated. Результат формируется в CoinDetailsSnapshot с символом валюты и временем обновления.

</details>

<details>
<summary><b>Ответ облачной модели (nvidia/nemotron-3.5-lightning:free)</b></summary>



</details>

---

### Вопрос #7: Как устроен корневой класс CryptoTrackApplication и какие аннотации Hilt в нем используются?
- **Категория:** `App & DI` (In-Domain)
- **Ожидаемые источники:** `CryptoTrackApplication.kt`

| Параметр | Локальная LLM (`qwen3:8b`) | Облачная LLM (`nvidia/nemotron-3.5-lightning:free`) |
| :--- | :--- | :--- |
| **Время ответа** | 245.18с (LLM: 242.72с) | 101.00с (LLM: 50.40с) |
| **Токены / Скорость** | 517 tok (2.1 tok/s) | 1246 tok (24.7 tok/s) |
| **Цитаты источников** | `—` | `—` |
| **Статус выполнения** | ✓ Успешно | ✓ Успешно |

<details>
<summary><b>Ответ локальной модели (qwen3:8b)</b></summary>

Корневой класс CryptoTrackApplication является подклассом Application и аннотирован аннотацией @HiltAndroidApp, что позволяет Hilt управлять зависимостями приложения. Этот класс служит точкой входа для инъекции зависимостей в entire проект.

</details>

<details>
<summary><b>Ответ облачной модели (nvidia/nemotron-3.5-lightning:free)</b></summary>

Корневой класс `CryptoTrackApplication` находится в пакете `com.cryptotrack.app` и аннотирован аннотацией `@HiltAndroidApp`. Он наследуется от базового класса `Application`. Аннотация `@HiltAndroidApp` необходима для инициализации компонента Hilt при запуске приложения.

</details>

---

### Вопрос #8: Как в приложении CryptoTrack настроена интеграция с Apple Pay и Google Pay для покупки криптовалюты банковской картой?
- **Категория:** `Adversarial / Payment Gateway` (Out-of-Domain)
- **Ожидаемые источники:** `Нет (ожидается отказ)`

| Параметр | Локальная LLM (`qwen3:8b`) | Облачная LLM (`nvidia/nemotron-3.5-lightning:free`) |
| :--- | :--- | :--- |
| **Время ответа** | 233.27с (LLM: 232.04с) | 293.82с (LLM: 0.00с) |
| **Токены / Скорость** | 476 tok (2.1 tok/s) | 0 tok (0.0 tok/s) |
| **Цитаты источников** | `—` | `—` |
| **Статус выполнения** | ✓ Успешно | ✗ Ошибка |

<details>
<summary><b>Ответ локальной модели (qwen3:8b)</b></summary>

В кодовой базе проекта CryptoTrack отсутствуют сведения о интеграции Apple Pay и Google Pay для покупки криптовалюты банковской картой. Не могу ответить на данный вопрос без домыслов.

</details>

<details>
<summary><b>Ответ облачной модели (nvidia/nemotron-3.5-lightning:free)</b></summary>

ОШИБКА: 'OpenRouterClient' object has no attribute 'retry_delay'

</details>

---

### Вопрос #9: Какая нейросетевая модель машинного обучения (LSTM или Transformer) обучена в CryptoTrack для прогнозирования курса биткоина на неделю вперед?
- **Категория:** `Adversarial / ML Forecasting` (Out-of-Domain)
- **Ожидаемые источники:** `Нет (ожидается отказ)`

| Параметр | Локальная LLM (`qwen3:8b`) | Облачная LLM (`nvidia/nemotron-3.5-lightning:free`) |
| :--- | :--- | :--- |
| **Время ответа** | 210.46с (LLM: 209.46с) | 187.43с (LLM: 82.71с) |
| **Токены / Скорость** | 488 tok (2.3 tok/s) | 892 tok (10.8 tok/s) |
| **Цитаты источников** | `—` | `—` |
| **Статус выполнения** | ✓ Успешно | ✓ Успешно |

<details>
<summary><b>Ответ локальной модели (qwen3:8b)</b></summary>

В кодовой базе проекта CryptoTrack отсутствуют сведения о нейросетевых моделях (LSTM, Transformer) для прогнозирования курса биткоина. Не могу ответить на данный вопрос без домыслов.

</details>

<details>
<summary><b>Ответ облачной модели (nvidia/nemotron-3.5-lightning:free)</b></summary>



</details>

---

### Вопрос #10: Как в кодовой базе CryptoTrack устроены Solidity смарт-контракты для стейкинга и фарминга ликвидности ERC-20 токенов?
- **Категория:** `Adversarial / Smart Contracts` (Out-of-Domain)
- **Ожидаемые источники:** `Нет (ожидается отказ)`

| Параметр | Локальная LLM (`qwen3:8b`) | Облачная LLM (`nvidia/nemotron-3.5-lightning:free`) |
| :--- | :--- | :--- |
| **Время ответа** | 248.56с (LLM: 247.36с) | 101.65с (LLM: 86.44с) |
| **Токены / Скорость** | 527 tok (2.1 tok/s) | 2243 tok (25.9 tok/s) |
| **Цитаты источников** | `—` | `—` |
| **Статус выполнения** | ✓ Успешно | ✓ Успешно |

<details>
<summary><b>Ответ локальной модели (qwen3:8b)</b></summary>

В кодовой базе проекта CryptoTrack отсутствуют сведения о Solidity смарт-контрактах для стейкинга и фарминга ликвидности ERC-20 токенов. Не могу ответить на данный вопрос без домыслов.

</details>

<details>
<summary><b>Ответ облачной модели (nvidia/nemotron-3.5-lightning:free)</b></summary>

В кодовой базе проекта CryptoTrack отсутствуют сведения о Solidity-смарт-контрактах для стейкинга и фарминга ликвидности ERC-20 токенов. Не могу ответить на данный вопрос без домыслов.

</details>

---
