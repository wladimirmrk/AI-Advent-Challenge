from dataclasses import dataclass, field
from typing import List


@dataclass
class BenchmarkQuestion:
    id: int
    category: str
    question: str
    expectation: str
    expected_sources: List[str]
    key_entities: List[str] = field(default_factory=list)


BENCHMARK_QUESTIONS: List[BenchmarkQuestion] = [
    BenchmarkQuestion(
        id=1,
        category="Domain Validation",
        question="Как в проекте CryptoTrack в объекте AssetAmountValidator реализована валидация и очистка (sanitize) пользовательского ввода для количества монет/активов?",
        expectation=(
            "Объект AssetAmountValidator реализует метод sanitize() (замена запятых на точки, удаление нецифровых символов кроме первой точки) "
            "и метод validate(), возвращающий sealed interface AssetAmountValidation с состояниями Valid(amount: BigDecimal), Empty, "
            "InvalidFormat, NotPositive. Валидация вынесена в domain-слой для переиспользования между Add sheet и Edit screen (ссылка на ADR-017)."
        ),
        expected_sources=[
            "feature/assetentry/src/main/kotlin/com/cryptotrack/feature/assetentry/domain/AssetAmountValidator.kt",
        ],
        key_entities=[
            "AssetAmountValidator",
            "sanitize",
            "validate",
            "AssetAmountValidation",
            "Valid",
            "Empty",
            "InvalidFormat",
            "NotPositive",
            "ADR-017",
        ],
    ),
    BenchmarkQuestion(
        id=2,
        category="Data Persistence",
        question="Какие сущности (Entities) и DAO зарегистрированы в основной базе данных Room CryptoTrackDatabase?",
        expectation=(
            "Абстрактный класс CryptoTrackDatabase (наследует RoomDatabase, версия 1, exportSchema = true) объявляет DAO: "
            "CacheMetaDao, CoinDetailsDao, FavoriteDao, HoldingDao, MarketCoinDao. База объединяет локальный кэш маркета, "
            "сохраненные избранные монеты и данные портфеля пользователя."
        ),
        expected_sources=[
            "core/data/src/main/kotlin/com/cryptotrack/core/data/database/CryptoTrackDatabase.kt",
        ],
        key_entities=[
            "CryptoTrackDatabase",
            "RoomDatabase",
            "CoinDetailsDao",
            "FavoriteDao",
            "HoldingDao",
            "MarketCoinDao",
            "CacheMetaDao",
        ],
    ),
    BenchmarkQuestion(
        id=3,
        category="Domain Financial Calculation",
        question="Как в PortfolioCalculator вычисляется общая стоимость портфеля и прибыль/убыток (PnL)?",
        expectation=(
            "Класс PortfolioCalculator производит высокоточные финансовые расчеты с использованием BigDecimal и MathContext. "
            "Вычисляет totalValue суммированием рыночной стоимости всех Holdings, абсолютный totalPnl как разность между текущей стоимостью "
            "и суммарной стоимостью покупки (totalCost), относительный PnL в процентах и долю каждого актива allocationPercent в структуре портфеля."
        ),
        expected_sources=[
            "feature/portfolio/src/main/kotlin/com/cryptotrack/feature/portfolio/domain/PortfolioCalculator.kt",
        ],
        key_entities=[
            "PortfolioCalculator",
            "totalValue",
            "totalPnl",
            "BigDecimal",
            "PortfolioPosition",
            "PortfolioSummary",
            "allocationPercent",
        ],
    ),
    BenchmarkQuestion(
        id=4,
        category="Build Logic & Conventions",
        question="За что отвечает плагин RoomConventionPlugin и как он настраивает KSP и директорию схемы Room?",
        expectation=(
            "Gradle convention plugin RoomConventionPlugin применяет плагины 'androidx.room' и 'com.google.devtools.ksp'. "
            "Конфигурирует RoomExtension, задавая schemaDirectory в '$projectDir/schemas', настраивает аргументы KSP "
            "('room.generateKotlin' = true), а также подключает runtime-библиотеки и KSP-компилятор Room через Version Catalog."
        ),
        expected_sources=[
            "build-logic/src/main/kotlin/com/cryptotrack/buildlogic/RoomConventionPlugin.kt",
        ],
        key_entities=[
            "RoomConventionPlugin",
            "androidx.room",
            "ksp",
            "schemaDirectory",
            "RoomExtension",
            "room.generateKotlin",
        ],
    ),
    BenchmarkQuestion(
        id=5,
        category="UI & Navigation",
        question="Какие главные экраны входят в нижнюю панель навигации (ApexBottomBar) приложения и какие иконки используются?",
        expectation=(
            "Компонент ApexBottomBar использует Material3 NavigationBar и NavigationBarItem. Навигационные пункты определены "
            "через enum/список TopDestination: Market (иконка ShowChart), Portfolio (иконка AccountBalanceWallet) и "
            "Favorites/Watchlist (иконка Star / StarBorder), обеспечивая переход между ключевыми графами приложения."
        ),
        expected_sources=[
            "app/src/main/kotlin/com/cryptotrack/app/ApexBottomBar.kt",
            "app/src/main/kotlin/com/cryptotrack/app/TopDestination.kt",
        ],
        key_entities=[
            "ApexBottomBar",
            "TopDestination",
            "NavigationBar",
            "NavigationBarItem",
            "ShowChart",
            "AccountBalanceWallet",
            "Star",
        ],
    ),
    BenchmarkQuestion(
        id=6,
        category="Domain Asset Entry",
        question="Как EstimatedValueCalculator рассчитывает оценочную стоимость позиции при вводе количества монет?",
        expectation=(
            "EstimatedValueCalculator принимает количество актива (BigDecimal) и текущую цену за единицу монеты. "
            "При наличии валидного положительного числа выполняет умножение с округлением до двух знаков после запятой (для фиатной валюты). "
            "Если цена отсутствует или количество пустое/невалидное, возвращает null или безопасное значение без падения."
        ),
        expected_sources=[
            "feature/assetentry/src/main/kotlin/com/cryptotrack/feature/assetentry/domain/EstimatedValueCalculator.kt",
        ],
        key_entities=[
            "EstimatedValueCalculator",
            "BigDecimal",
            "calculate",
            "price",
            "amount",
        ],
    ),
    BenchmarkQuestion(
        id=7,
        category="Domain UseCase Orchestration",
        question="Какую информацию агрегирует UseCase ObserveCoinDetailsUseCase и из каких репозиториев?",
        expectation=(
            "ObserveCoinDetailsUseCase объединяет несколько потоков данных (Flow): рыночные данные монеты (информация и график цен) из MarketRepository, "
            "статус добавления в закладки/избранное из FavoriteRepository и наличие существующих холдингов/позиций в портфеле пользователя из "
            "PortfolioRepository / HoldingRepository, собирая единый composite UI state."
        ),
        expected_sources=[
            "feature/coin-details/src/main/kotlin/com/cryptotrack/feature/coindetails/domain/ObserveCoinDetailsUseCase.kt",
        ],
        key_entities=[
            "ObserveCoinDetailsUseCase",
            "MarketRepository",
            "FavoriteRepository",
            "HoldingRepository",
            "Flow",
            "combine",
        ],
    ),
    BenchmarkQuestion(
        id=8,
        category="Domain Search Flow",
        question="Как устроен UseCase SearchCoinsUseCase для поиска криптовалют?",
        expectation=(
            "SearchCoinsUseCase инкапсулирует логику поиска: принимает поисковый запрос (query), очищает граничные пробелы, "
            "проверяет граничные условия (например, пустая строка возвращает пустой список или результат по умолчанию), "
            "делегирует поиск в MarketRepository и оборачивает результат в стандартный wrapper Result<List<Coin>>."
        ),
        expected_sources=[
            "feature/search/src/main/kotlin/com/cryptotrack/feature/search/domain/SearchCoinsUseCase.kt",
        ],
        key_entities=[
            "SearchCoinsUseCase",
            "MarketRepository",
            "query",
            "Result",
        ],
    ),
    BenchmarkQuestion(
        id=9,
        category="Build Logic Conventions",
        question="Какие соглашения и зависимости настраивает FeatureConventionPlugin для любого feature-модуля?",
        expectation=(
            "FeatureConventionPlugin стандартизирует структуру функциональных модулей: подключает AndroidLibraryConventionPlugin, "
            "HiltConventionPlugin, ComposeConventionPlugin, настраивает общие зависимости на базовые модули (:core:model, "
            ":core:designsystem, :core:common, :core:data) и библиотеки AndroidX Lifecycle ViewModel и Navigation Compose."
        ),
        expected_sources=[
            "build-logic/src/main/kotlin/com/cryptotrack/buildlogic/FeatureConventionPlugin.kt",
        ],
        key_entities=[
            "FeatureConventionPlugin",
            "AndroidLibraryConventionPlugin",
            "HiltConventionPlugin",
            "ComposeConventionPlugin",
            "core:model",
            "core:designsystem",
            "core:common",
        ],
    ),
    BenchmarkQuestion(
        id=10,
        category="Application & Dependency Injection",
        question="Как устроен корневой класс CryptoTrackApplication и какие аннотации Hilt в нем используются?",
        expectation=(
            "Класс CryptoTrackApplication наследует android.app.Application и помечен ключевой аннотацией @HiltAndroidApp, "
            "которая запускает кодогенерацию компонентов Hilt и формирует корень графа внедрения зависимостей. "
            "В onCreate() при необходимости инициализируются фоновые подсистемы или логирование."
        ),
        expected_sources=[
            "app/src/main/kotlin/com/cryptotrack/app/CryptoTrackApplication.kt",
        ],
        key_entities=[
            "CryptoTrackApplication",
            "Application",
            "@HiltAndroidApp",
            "Hilt",
            "onCreate",
        ],
    ),
]
