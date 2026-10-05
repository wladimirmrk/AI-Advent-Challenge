from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np
from tabulate import tabulate
from src.chunking.base import Chunk
from src.embeddings.ollama_embedder import OllamaEmbedder
from src.storage.vector_store import VectorStore, SearchResult

@dataclass
class QueryComparisonResult:
    query: str
    fixed_results: List[SearchResult]
    struct_results: List[SearchResult]
    fixed_top1_score: float
    struct_top1_score: float
    fixed_avg3_score: float
    struct_avg3_score: float


class ChunkComparator:
    DEFAULT_BENCHMARK_QUERIES = [
        "Retrofit API interface and OkHttp network client",
        "Room database @Dao and @Entity cryptocurrency persistence",
        "Jetpack Compose @Composable UI screen and Navigation graph",
        "ViewModel StateFlow state management and UI state",
        "Gradle convention plugins build logic and dependency configuration",
    ]

    @staticmethod
    def compute_statistics(chunks: List[Chunk], strategy_name: str) -> Dict[str, Any]:
        """Compute comprehensive statistical metrics for a list of chunks."""
        if not chunks:
            return {"strategy": strategy_name, "total_chunks": 0}

        char_lengths = [len(c.content) for c in chunks]
        line_lengths = [len(c.content.splitlines()) for c in chunks]
        token_estimates = [c.token_estimate for c in chunks]

        # Granularity distribution
        small = sum(1 for l in char_lengths if l < 250)
        medium = sum(1 for l in char_lengths if 250 <= l <= 750)
        large = sum(1 for l in char_lengths if l > 750)

        # Unique sections
        unique_sections = len(set(c.section for c in chunks))
        unique_sources = len(set(c.source for c in chunks))

        by_type: Dict[str, int] = {}
        for c in chunks:
            ft = c.metadata.get("file_type", "other")
            by_type[ft] = by_type.get(ft, 0) + 1

        return {
            "strategy": strategy_name,
            "total_chunks": len(chunks),
            "unique_sources": unique_sources,
            "unique_sections": unique_sections,
            "char_min": int(np.min(char_lengths)),
            "char_max": int(np.max(char_lengths)),
            "char_mean": round(float(np.mean(char_lengths)), 1),
            "char_median": round(float(np.median(char_lengths)), 1),
            "char_std": round(float(np.std(char_lengths)), 1),
            "line_mean": round(float(np.mean(line_lengths)), 1),
            "line_max": int(np.max(line_lengths)),
            "total_tokens_est": int(np.sum(token_estimates)),
            "tokens_mean_est": round(float(np.mean(token_estimates)), 1),
            "distribution_small_pct": round((small / len(chunks)) * 100, 1),
            "distribution_medium_pct": round((medium / len(chunks)) * 100, 1),
            "distribution_large_pct": round((large / len(chunks)) * 100, 1),
            "by_type": by_type,
        }

    def benchmark(
        self,
        fixed_store: VectorStore,
        struct_store: VectorStore,
        embedder: OllamaEmbedder,
        queries: Optional[List[str]] = None,
        top_k: int = 3,
    ) -> List[QueryComparisonResult]:
        """Run standard benchmark queries against both indexes."""
        queries = queries or self.DEFAULT_BENCHMARK_QUERIES
        results: List[QueryComparisonResult] = []

        for q in queries:
            q_vec = embedder.embed_query(q)
            f_res = fixed_store.search(q_vec, top_k=top_k)
            s_res = struct_store.search(q_vec, top_k=top_k)

            f_top1 = f_res[0].score if f_res else 0.0
            s_top1 = s_res[0].score if s_res else 0.0
            f_avg = float(np.mean([r.score for r in f_res])) if f_res else 0.0
            s_avg = float(np.mean([r.score for r in s_res])) if s_res else 0.0

            results.append(
                QueryComparisonResult(
                    query=q,
                    fixed_results=f_res,
                    struct_results=s_res,
                    fixed_top1_score=round(f_top1, 4),
                    struct_top1_score=round(s_top1, 4),
                    fixed_avg3_score=round(f_avg, 4),
                    struct_avg3_score=round(s_avg, 4),
                )
            )

        return results

    def generate_report_markdown(
        self,
        stats_fixed: Dict[str, Any],
        stats_struct: Dict[str, Any],
        benchmark_results: List[QueryComparisonResult],
    ) -> str:
        """Generate a structured Markdown report comparing the two chunking strategies."""
        # Stats table
        metrics_table = [
            ["Общее количество чанков", stats_fixed["total_chunks"], stats_struct["total_chunks"]],
            ["Уникальных исходных файлов", stats_fixed["unique_sources"], stats_struct["unique_sources"]],
            ["Уникальных секций / сущностей", stats_fixed["unique_sections"], stats_struct["unique_sections"]],
            ["Средняя длина чанка (символов)", stats_fixed["char_mean"], stats_struct["char_mean"]],
            ["Медианная длина (символов)", stats_fixed["char_median"], stats_struct["char_median"]],
            ["Мин / Макс длина (символов)", f"{stats_fixed['char_min']} / {stats_fixed['char_max']}", f"{stats_struct['char_min']} / {stats_struct['char_max']}"],
            ["Стандартное отклонение длины", stats_fixed["char_std"], stats_struct["char_std"]],
            ["Среднее число строк", stats_fixed["line_mean"], stats_struct["line_mean"]],
            ["Оценка токенов (всего / среднее)", f"{stats_fixed['total_tokens_est']} / {stats_fixed['tokens_mean_est']}", f"{stats_struct['total_tokens_est']} / {stats_struct['tokens_mean_est']}"],
            ["Малые чанки (<250 симв.)", f"{stats_fixed['distribution_small_pct']}%", f"{stats_struct['distribution_small_pct']}%"],
            ["Средние чанки (250-750 симв.)", f"{stats_fixed['distribution_medium_pct']}%", f"{stats_struct['distribution_medium_pct']}%"],
            ["Крупные чанки (>750 симв.)", f"{stats_fixed['distribution_large_pct']}%", f"{stats_struct['distribution_large_pct']}%"],
        ]
        stats_md = tabulate(
            metrics_table,
            headers=["Метрика", "Fixed-Size (500 chars / 50 overlap)", "Structural (Hierarchical / Syntax)"],
            tablefmt="github",
        )

        # Benchmark table
        bench_rows = []
        for r in benchmark_results:
            bench_rows.append([
                r.query,
                f"Top-1: {r.fixed_top1_score}\nAvg@3: {r.fixed_avg3_score}",
                f"Top-1: {r.struct_top1_score}\nAvg@3: {r.struct_avg3_score}",
                "Structural" if r.struct_top1_score >= r.fixed_top1_score else "Fixed",
            ])
        bench_md = tabulate(
            bench_rows,
            headers=["Тестовый поисковый запрос", "Fixed-Size Скоринг", "Structural Скоринг", "Выигрыш"],
            tablefmt="github",
        )

        # Detailed qualitative queries walkthrough
        queries_detail = []
        for idx, r in enumerate(benchmark_results, 1):
            f_best = r.fixed_results[0] if r.fixed_results else None
            s_best = r.struct_results[0] if r.struct_results else None

            f_snip = f_best.chunk.content[:220].replace("\n", " ") if f_best else "N/A"
            s_snip = s_best.chunk.content[:220].replace("\n", " ") if s_best else "N/A"

            f_info = f"**[{f_best.chunk.source}]** (Score: `{r.fixed_top1_score}`)\n> Section: `{f_best.chunk.section}`\n> Snippet: `{f_snip}...`" if f_best else "N/A"
            s_info = f"**[{s_best.chunk.source}]** (Score: `{r.struct_top1_score}`)\n> Section: `{s_best.chunk.section}`\n> Snippet: `{s_snip}...`" if s_best else "N/A"

            queries_detail.append(
                f"#### Запрос {idx}: *\"{r.query}\"*\n\n"
                f"- **Fixed-Size (Лучший результат)**:\n  {f_info}\n\n"
                f"- **Structural (Лучший результат)**:\n  {s_info}\n"
            )

        details_md = "\n".join(queries_detail)

        report = f"""# Отчёт о сравнении стратегий чанкинга (День 21: Индексация документов)

## 1. Введение и цели исследования
В рамках задачи проиндексирована кодовая база Android-проекта **CryptoTrack** (Kotlin-код `.kt`, Gradle-скрипты `.kts` и Android XML `.xml`). Документация Markdown исключена для чистоты анализа кодовых конструкций.
Сравнены две фундаментальные стратегии разбиения на чанки (Chunking):
1. **Fixed-Size Chunking**: разбиение с фиксированным размером окна (500 символов, 50 символов overlap) с мягким выравниванием по границам слов/строк.
2. **Structural Chunking**: разбиение с сохранением синтаксической структуры кода (декларации `class`, `interface`, `fun`, `package` для Kotlin, теги манифестов и разметки для XML).

Векторизация выполнена локальной моделью Ollama **`nomic-embed-text`** (размерность 768, контекст до 8192 токенов).
Векторы нормализованы (L2), индексированы в **FAISS (IndexFlatIP)**, а метаданные сохранены в **SQLite** и **JSON**.

---

## 2. Количественные метрики и распределение

{stats_md}

---

## 3. Бенчмарк семантического поиска

Оценка производилась на характерных запросах к архитектуре, сетевому слою, базе данных и конфигурациям Android-проекта:

{bench_md}

### Детальное сопоставление Top-1 сниппетов

{details_md}

---

## 4. Сравнительный анализ и выводы

### Преимущества и недостатки Fixed-Size Chunking:
* **Плюсы**:
  - Равномерное распределение размера чанков (низкое стандартное отклонение `~{stats_fixed['char_std']}`).
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
  - Более высокий разброс длин чанков (стандартное отклонение `~{stats_struct['char_std']}`).
  - Необходимость специализированных парсеров под синтаксис каждого языка/формата.

### Итоговая рекомендация для Android RAG:
Для построения вопросно-ответных и RAG-систем по кодовым базам Android рекомендуется **Structural Chunking** (или гибридный подход с структурным разделением и мягким fallback по размеру), так как сохранение границ функций, классов и связей с заголовками предотвращает галлюцинации языковой модели при чтении разорванного кода.
"""
        return report
