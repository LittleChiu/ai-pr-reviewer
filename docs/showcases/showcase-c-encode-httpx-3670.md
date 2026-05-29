# Showcase C: encode/httpx#3670

**PR**: [https://github.com/encode/httpx/pull/3670](https://github.com/encode/httpx/pull/3670)
**主题**: FileStream API 重构
**为什么选**: 演示对涉及多模块行为改变的高复杂度评审

## 评审输出

- **模型**: `deepseek-v4-pro-max`
- **用时**: 78.5 s
- **LLM 调用次数**: 3
- **Token 消耗**: 7,260 prompt + 4,262 completion = **11,522** total

### 📋 总结

这个PR修复了httpx库中服务器文件响应（File）的API，主要改动了同步和异步版本的_streams.py和_content.py，以及对应的测试文件。通过调整FileStream类的实现，使得开发者可以更简洁地使用`httpx.File`和`httpx.Response`来返回文件内容。改动集中在底层流处理和内容包装层，涉及文件和字节流的处理逻辑。

### ✨ 亮点

- 统一了同步和异步的File响应接口，降低了使用复杂度
- 精简了_streams.py中的重复代码，提升了维护性

### ⚠️ 风险 (7)

#### [HIGH/bug] `src/ahttpx/_streams.py` L205, 218  — *high confidence*

**对普通文件对象调用 `await self._fin.close()` 和 `await self._fin.read()` 会抛出 TypeError**

`self._fin` 被赋值为 `open(value, 'rb')` 返回的同步文件对象（`io.BufferedReader`），其 `read()` 和 `close()` 方法是普通同步方法，不是协程。对它们使用 `await` 会引发 `TypeError: object NoneType can't be used in 'await' expression`（Python 会尝试 await 一个非可等待对象）。修改方向：要么改用 `aiofiles.open()` 返回异步文件对象，要么去掉 `await`，直接调用同步方法（`self._fin.read(...)` / `self._fin.close()`）。同样的问题也出现在 `MultiPartStream.close()` 的第 218 行。

#### [MEDIUM/perf] `src/ahttpx/_streams.py` L91  — *high confidence*

**`FileStream.size` 每次调用都执行系统调用 `os.path.getsize`**

原实现在 `open()` 时缓存了文件大小，新实现改为每次访问 `size` 属性时都调用 `os.path.getsize(self._path)`。如果该属性被频繁访问（例如在循环或 HTTP Content-Length 计算中），会产生不必要的重复系统调用，且在文件被删除/替换后结果可能与已打开的文件不一致。建议在构造函数中一次性缓存：`self._size = os.path.getsize(path)`，然后 `return self._size`。

#### [MEDIUM/bug] `src/ahttpx/_streams.py` L78-79  — *high confidence*

**`FileStream.__init__` 接受外部传入的 `fin`，但调用方 `MultiPartStream` 直接用 `open()` 而不通过 `FileStream`，导致 `FileStream` 类实际上已无人使用**

`FileStream` 的构造函数签名改为需要外部传入已打开的文件对象，但 `MultiPartStream._read_next_section` 中直接使用 `open(value, 'rb')` 并将结果存入 `self._fin`，完全绕过了 `FileStream`。这意味着 `FileStream` 类的 `read`/`close`/`size` 逻辑（包括 `async` 包装）对 `MultiPartStream` 没有任何作用，两处代码各自维护，容易产生不一致。建议统一：要么让 `MultiPartStream` 继续使用 `FileStream`，要么删除 `FileStream` 类。

#### [MEDIUM/perf] `src/httpx/_streams.py` L91-92  — *high confidence*

**FileStream.size 每次调用都触发系统调用 os.path.getsize**

原实现在 open() 时缓存了文件大小，新实现在每次访问 size 属性时都调用 os.path.getsize(self._path)。如果 size 被频繁访问（例如在循环或 Content-Length 计算中），会产生不必要的重复系统调用。此外，如果文件在 FileStream 构造后被外部修改或删除，返回的大小可能与实际读取内容不一致，导致 Content-Length 错误。建议在构造函数中一次性缓存：self._size = os.path.getsize(path)，然后 size 属性直接返回 self._size。

#### [MEDIUM/bug] `src/httpx/_streams.py` L78-79  — *high confidence*

**FileStream 构造函数签名变更破坏了原有的外部调用方式**

原来 FileStream(path) 是公开 API，调用方只需传路径，内部负责打开文件。新签名 FileStream(path, fin) 要求调用方同时传入已打开的文件对象，但 MultiPartStream 内部已改为直接 open(value, 'rb') 而不再使用 FileStream。这意味着 FileStream 类本身变成了一个几乎没有实际用途的薄包装（只是转发 read/close），且其构造函数语义不清晰——path 仅用于 size 查询，fin 才是实际 I/O 对象，两者可能不一致（例如传入的 fin 对应不同文件）。建议要么让 FileStream 内部自己 open 文件（恢复原逻辑），要么彻底移除 FileStream 类（MultiPartStream 已不再使用它）。

#### [LOW/bug] `src/ahttpx/_streams.py` L85-86  — *medium confidence*

**`FileStream.close()` 不检查 `_fin` 是否已关闭，重复关闭可能引发异常**

原实现有 `if self._fileobj is not None` 的保护，新实现直接调用 `self._fin.close()`，若 `_fin` 已被关闭或为 None（构造时传入 None），会抛出 `AttributeError` 或对已关闭文件重复关闭（虽然 CPython 的文件对象允许重复 close，但语义上不安全）。建议保留 None 检查或在构造函数中断言 `fin is not None`。

#### [LOW/bug] `src/httpx/_streams.py` L78-79  — *medium confidence*

**FileStream 缺少 __enter__ 方法，但基类 Stream 有默认实现**

原来 FileStream 重写了 __enter__ 以执行 open()，新版本删除了该重写，依赖基类 Stream.__enter__ 直接返回 self（不做任何打开操作）。由于 fin 现在由外部传入，这在语义上是正确的，但如果有代码依赖 `with FileStream(path) as f:` 的模式来触发文件打开，则会静默失效。结合上一条风险，FileStream 的职责边界需要明确。

### 💡 建议 (4)

#### `src/ahttpx/_streams.py` L196-218  — *high confidence*

**在 `MultiPartStream` 中统一使用同步调用或切换到 aiofiles**

当前混用了 `await self._fin.read()` 和 `await self._fin.close()`（同步文件对象），应统一去掉 `await`，或改用 `aiofiles` 以真正实现异步 I/O，避免在事件循环中阻塞。

```
# 方案一：去掉 await，使用同步调用
chunk = self._fin.read(64*1024)
...
self._fin.close()

# 方案二：使用 aiofiles
import aiofiles
self._fin = await aiofiles.open(value, 'rb')
chunk = await self._fin.read(64*1024)
await self._fin.close()
```

#### `src/ahttpx/_streams.py` L78  — *medium confidence*

**考虑恢复 `FileStream` 的工厂方法或类方法，使其能自行打开文件**

将文件打开逻辑放在 `FileStream` 内部（如类方法 `FileStream.open(path)`）可以封装资源管理，避免调用方直接操作裸文件对象，也便于统一切换到 aiofiles。

```
@classmethod
async def open(cls, path: str) -> 'FileStream':
    fin = open(path, 'rb')  # 或 await aiofiles.open(path, 'rb')
    return cls(path, fin)
```

#### `src/httpx/_streams.py` L78-92  — *high confidence*

**考虑移除 FileStream 类或恢复其自管理文件生命周期的设计**

重构后 MultiPartStream 直接使用 open() 而不再通过 FileStream，FileStream 类变成了死代码（或几乎无用的包装）。如果没有其他外部使用者，可以直接删除 FileStream 以减少维护负担。如果需要保留，应让它自己负责打开和关闭文件，保持封装性。

```
class FileStream(Stream):
    def __init__(self, path: str) -> None:
        self._path = path
        self._fin = open(path, 'rb')
        self._size = os.path.getsize(path)

    def read(self, size: int = -1) -> bytes:
        return self._fin.read(size)

    def close(self) -> None:
        self._fin.close()

    @property
    def size(self) -> int | None:
        return self._size
```

#### `src/httpx/_streams.py` L140  — *medium confidence*

**将 _fin 的类型注解从 typing.Any 改为更精确的 Protocol 或 IO[bytes]**

使用 typing.Any 会绕过类型检查。可以使用 typing.IO[bytes] 或 typing.Optional[typing.IO[bytes]] 来准确描述文件对象的类型，提升类型安全性。

```
self._fin: typing.Optional[typing.IO[bytes]] = None
```
