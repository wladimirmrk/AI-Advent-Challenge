from src.loader.project_loader import Document
from src.chunking.fixed_chunker import FixedChunker
from src.chunking.structural_chunker import StructuralChunker

def test_fixed_chunker():
    doc = Document(
        file_path="/test/doc.txt",
        relative_path="doc.txt",
        extension=".txt",
        file_type="text",
        content="Word " * 200,  # 1000 characters
        char_count=1000,
        line_count=1,
    )
    chunker = FixedChunker(chunk_size=300, chunk_overlap=50)
    chunks = chunker.chunk_document(doc)

    assert len(chunks) >= 3
    for c in chunks:
        assert c.strategy == "fixed"
        assert c.chunk_id.startswith("fixed_")
        assert "start_line" in c.metadata
        assert "end_line" in c.metadata
        assert c.token_estimate > 0


def test_structural_chunker_compose_ui():
    ui_content = """package com.example.crypto.ui

import androidx.compose.runtime.Composable
import androidx.compose.material3.Text

@Composable
fun CryptoScreen(state: String) {
    Text(text = "Crypto Price: $state")
}

@Composable
fun TopBar(title: String) {
    Text(text = title)
}
"""
    doc = Document(
        file_path="/test/CryptoScreen.kt",
        relative_path="CryptoScreen.kt",
        extension=".kt",
        file_type="kotlin",
        content=ui_content,
        char_count=len(ui_content),
        line_count=len(ui_content.splitlines()),
    )
    chunker = StructuralChunker(max_chunk_size=1000)
    chunks = chunker.chunk_document(doc)

    assert len(chunks) >= 2
    sections = [c.section for c in chunks]
    assert any("fun CryptoScreen" in s for s in sections)
    assert any("fun TopBar" in s for s in sections)


def test_structural_chunker_kotlin():
    kt_content = """package com.example.crypto

import retrofit2.http.GET

interface CoinService {
    @GET("coins")
    suspend fun getCoins(): List<String>
}

class CoinRepository(private val api: CoinService) {
    fun fetch() = api.getCoins()
}
"""
    doc = Document(
        file_path="/test/CoinService.kt",
        relative_path="CoinService.kt",
        extension=".kt",
        file_type="kotlin",
        content=kt_content,
        char_count=len(kt_content),
        line_count=len(kt_content.splitlines()),
    )
    chunker = StructuralChunker(max_chunk_size=1000)
    chunks = chunker.chunk_document(doc)

    assert len(chunks) >= 2
    for c in chunks:
        assert c.strategy == "structural"
        assert c.source == "CoinService.kt"
        assert c.title == "CoinService.kt"
