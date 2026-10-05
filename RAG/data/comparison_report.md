# Отчёт о сравнении стратегий чанкинга (День 21: Индексация документов)

## 1. Введение и цели исследования
В рамках задачи проиндексирована кодовая база Android-проекта **CryptoTrack** (Kotlin-код `.kt`, Gradle-скрипты `.kts` и Android XML `.xml`). Документация Markdown исключена для чистоты анализа кодовых конструкций.
Сравнены две фундаментальные стратегии разбиения на чанки (Chunking):
1. **Fixed-Size Chunking**: разбиение с фиксированным размером окна (500 символов, 50 символов overlap) с мягким выравниванием по границам слов/строк.
2. **Structural Chunking**: разбиение с сохранением синтаксической структуры кода (декларации `class`, `interface`, `fun`, `package` для Kotlin, теги манифестов и разметки для XML).

Векторизация выполнена локальной моделью Ollama **`nomic-embed-text`** (размерность 768, контекст до 8192 токенов).
Векторы нормализованы (L2), индексированы в **FAISS (IndexFlatIP)**, а метаданные сохранены в **SQLite** и **JSON**.

---

## 2. Количественные метрики и распределение

| Метрика                          | Fixed-Size (500 chars / 50 overlap)   | Structural (Hierarchical / Syntax)   |
|----------------------------------|---------------------------------------|--------------------------------------|
| Общее количество чанков          | 1055                                  | 943                                  |
| Уникальных исходных файлов       | 180                                   | 180                                  |
| Уникальных секций / сущностей    | 1028                                  | 564                                  |
| Средняя длина чанка (символов)   | 439.6                                 | 443.8                                |
| Медианная длина (символов)       | 472.0                                 | 283.0                                |
| Мин / Макс длина (символов)      | 51 / 500                              | 11 / 2375                            |
| Стандартное отклонение длины     | 91.8                                  | 412.7                                |
| Среднее число строк              | 12.6                                  | 11.8                                 |
| Оценка токенов (всего / среднее) | 115546 / 109.5                        | 104272 / 110.6                       |
| Малые чанки (<250 симв.)         | 7.4%                                  | 45.6%                                |
| Средние чанки (250-750 симв.)    | 92.6%                                 | 30.3%                                |
| Крупные чанки (>750 симв.)       | 0.0%                                  | 24.1%                                |

---

## 3. Бенчмарк семантического поиска

Оценка производилась на характерных запросах к архитектуре, сетевому слою, базе данных и конфигурациям Android-проекта:

| Тестовый поисковый запрос                                          | Fixed-Size Скоринг   | Structural Скоринг   | Выигрыш    |
|--------------------------------------------------------------------|----------------------|----------------------|------------|
| Retrofit API interface and OkHttp network client                   | Top-1: 0.6832        | Top-1: 0.7401        | Structural |
|                                                                    | Avg@3: 0.6451        | Avg@3: 0.6674        |            |
| Room database @Dao and @Entity cryptocurrency persistence          | Top-1: 0.6997        | Top-1: 0.7044        | Structural |
|                                                                    | Avg@3: 0.6994        | Avg@3: 0.7025        |            |
| Jetpack Compose @Composable UI screen and Navigation graph         | Top-1: 0.6412        | Top-1: 0.6414        | Structural |
|                                                                    | Avg@3: 0.6382        | Avg@3: 0.6379        |            |
| ViewModel StateFlow state management and UI state                  | Top-1: 0.7115        | Top-1: 0.7321        | Structural |
|                                                                    | Avg@3: 0.6954        | Avg@3: 0.718         |            |
| Gradle convention plugins build logic and dependency configuration | Top-1: 0.7073        | Top-1: 0.6936        | Fixed      |
|                                                                    | Avg@3: 0.6966        | Avg@3: 0.6886        |            |

### Детальное сопоставление Top-1 сниппетов

#### Запрос 1: *"Retrofit API interface and OkHttp network client"*

- **Fixed-Size (Лучший результат)**:
  **[core/network/src/main/kotlin/com/cryptotrack/core/network/NetworkModule.kt]** (Score: `0.6832`)
> Section: `Offset 1754-2251 (L56-L74)`
> Snippet: `if (BuildConfig.DEBUG) {                             HttpLoggingInterceptor.Level.BASIC                         } else {                             HttpLoggingInterceptor.Level.NONE                         }            ...`

- **Structural (Лучший результат)**:
  **[core/network/src/main/kotlin/com/cryptotrack/core/network/NetworkModule.kt]** (Score: `0.7401`)
> Section: `NetworkModule > fun provideRetrofit`
> Snippet: `fun provideRetrofit(         client: OkHttpClient,         json: Json,     ): Retrofit =         Retrofit             .Builder()             .baseUrl(BASE_URL)             .client(client)             .addConverterFactory...`

#### Запрос 2: *"Room database @Dao and @Entity cryptocurrency persistence"*

- **Fixed-Size (Лучший результат)**:
  **[core/data/src/main/kotlin/com/cryptotrack/core/data/database/entity/HoldingEntity.kt]** (Score: `0.6997`)
> Section: `Offset 0-344 (L1-L12)`
> Snippet: `package com.cryptotrack.core.data.database.entity  import androidx.room.Entity import androidx.room.PrimaryKey  /** Холдинг портфеля (ADR-013: только локально). BigDecimal хранится строкой. */ @Entity(tableName = "holdin...`

- **Structural (Лучший результат)**:
  **[core/data/src/main/kotlin/com/cryptotrack/core/data/database/dao/HoldingDao.kt]** (Score: `0.7044`)
> Section: `Package & Imports: com.cryptotrack.core.data.database.dao`
> Snippet: `package com.cryptotrack.core.data.database.dao import androidx.room.Dao import androidx.room.Query import androidx.room.Upsert import com.cryptotrack.core.data.database.entity.HoldingEntity import kotlinx.coroutines.flow...`

#### Запрос 3: *"Jetpack Compose @Composable UI screen and Navigation graph"*

- **Fixed-Size (Лучший результат)**:
  **[feature/coin-details/src/main/kotlin/com/cryptotrack/feature/coindetails/presentation/CoinDetailsScreen.kt]** (Score: `0.6412`)
> Section: `Offset 819-1281 (L18-L27)`
> Snippet: `androidx.compose.material.icons.filled.AddCircle import androidx.compose.material.icons.filled.Star import androidx.compose.material.icons.filled.StarBorder import androidx.compose.material3.Button import androidx.compos...`

- **Structural (Лучший результат)**:
  **[feature/settings/src/main/kotlin/com/cryptotrack/feature/settings/navigation/SettingsGraph.kt]** (Score: `0.6414`)
> Section: `SettingsGraph > fun NavGraphBuilder`
> Snippet: `fun NavGraphBuilder.settingsGraph(     onBack: () -> Unit,     onAboutClick: () -> Unit,     onAboutTopicClick: (AboutTopic) -> Unit, ) {     composable<SettingsRoute> {         SettingsScreen(             onBack = onBac...`

#### Запрос 4: *"ViewModel StateFlow state management and UI state"*

- **Fixed-Size (Лучший результат)**:
  **[feature/settings/src/test/kotlin/com/cryptotrack/feature/settings/SettingsViewModelTest.kt]** (Score: `0.7115`)
> Section: `Offset 2971-3467 (L71-L87)`
> Snippet: `()     private val viewModel = SettingsViewModel(         settingsRepository = settings,         marketRepository = market,     )      @Test     fun `settings values emit into ui state`() = runTest {         settings.set...`

- **Structural (Лучший результат)**:
  **[feature/settings/src/main/kotlin/com/cryptotrack/feature/settings/presentation/SettingsViewModel.kt]** (Score: `0.7321`)
> Section: `SettingsViewModel > class SettingsViewModel`
> Snippet: `val uiState: StateFlow<SettingsUiState> = combine(         settingsRepository.settings,         apiStatus,     ) { settings, status ->         SettingsUiState(             currency = settings.currency,             isDark...`

#### Запрос 5: *"Gradle convention plugins build logic and dependency configuration"*

- **Fixed-Size (Лучший результат)**:
  **[settings.gradle.kts]** (Score: `0.7073`)
> Section: `Offset 0-484 (L1-L19)`
> Snippet: `pluginManagement {     includeBuild("build-logic")     repositories {         google {             content {                 includeGroupByRegex("com\\.android.*")                 includeGroupByRegex("com\\.google.*")   ...`

- **Structural (Лучший результат)**:
  **[build-logic/settings.gradle.kts]** (Score: `0.6936`)
> Section: `settings.gradle > settings.gradle`
> Snippet: `dependencyResolutionManagement {     repositories {         google()         mavenCentral()         gradlePluginPortal()     }     versionCatalogs {         create("libs") {             from(files("../gradle/libs.version...`


---

## 4. Сравнительный анализ и выводы

### Преимущества и недостатки Fixed-Size Chunking:
* **Плюсы**:
  - Равномерное распределение размера чанков (низкое стандартное отклонение `~91.8`).
  - Высокая предсказуемость расхода токенов и времени инференса эмбеддингов.
  - Простота реализации.
* **Минусы**:
  - Границы чанков могут разрезать логические блоки: функцию Kotlin пополам, сигнатуру отдельно от реализации, или оторвать заголовок раздела от его описания.
  - Метаданные секций не отражают семантику кода (вместо имени класса/функции используется диапазон строк).

### Преимущества и недостатки Structural Chunking:
* **Плюсы**:
  - **Целостность контекста**: Каждый чанк представляет собой законченную сущность (класс, функцию, раздел документации).
  - **Богатые метаданные**: Каждый чанк знает точный breadcrumb раздела (например, `CoinGeckoRepository > fetchMarketData()` или `Overview > Architecture > Database`).
  - **Более высокая семантическая точность**: При поиске кода или архитектурных разделов structural chunking обеспечивает более релевантный контекст для LLM в RAG-пайплайне.
* **Минусы**:
  - Более высокий разброс длин чанков (стандартное отклонение `~412.7`).
  - Необходимость специализированных парсеров под синтаксис каждого языка/формата.

### Итоговая рекомендация для Android RAG:
Для построения вопросно-ответных и RAG-систем по кодовым базам Android рекомендуется **Structural Chunking** (или гибридный подход с структурным разделением и мягким fallback по размеру), так как сохранение границ функций, классов и связей с заголовками предотвращает галлюцинации языковой модели при чтении разорванного кода.
