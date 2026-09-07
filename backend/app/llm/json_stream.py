"""Incremental JSON string projection. Never exposes keys or incomplete escapes."""
import json


class JsonStringStream:
    def __init__(self, field: str = "body", *, allow_plain: bool = True) -> None:
        self.field = field
        self.allow_plain = allow_plain
        self.buffer = ""
        self.pos = 0
        self.mode = "pending"
        self.depth = 0
        self.in_string = False
        self.target = False
        self.key = ""
        self.previous = ""
        self.string_start = 0

    def feed(self, chunk: str) -> str:
        self.buffer += chunk
        if self.mode == "pending":
            prefix = self.buffer.lstrip()
            if not prefix:
                return ""
            if prefix.startswith('`'):
                if '\n' not in prefix:
                    return ""
                self.pos = self.buffer.index('\n') + 1
                prefix = self.buffer[self.pos:].lstrip()
                if not prefix:
                    return ""
            if prefix.startswith('{'):
                self.mode = "json"
            elif prefix.startswith(("[", '"')):
                self.mode = "ignore"
            else:
                self.mode = "plain" if self.allow_plain else "ignore"
        if self.mode == "ignore":
            return ""
        if self.mode == "plain":
            text = self.buffer[self.pos:]
            self.pos = len(self.buffer)
            return text

        output: list[str] = []
        while self.pos < len(self.buffer):
            char = self.buffer[self.pos]
            if self.in_string:
                if char == '"':
                    if not self.target and self.depth == 1 and self.previous in ('{', ','):
                        self.key = json.loads(self.buffer[self.string_start:self.pos + 1])
                    self.in_string = False
                    self.previous = '"'
                elif char == '\\':
                    size = 6 if self.buffer[self.pos:self.pos + 2] == '\\u' else 2
                    if self.pos + size > len(self.buffer):
                        break
                    escaped = self.buffer[self.pos:self.pos + size]
                    if size == 6 and 0xD800 <= int(escaped[2:], 16) <= 0xDBFF:
                        if self.pos + 12 > len(self.buffer):
                            break
                        escaped = self.buffer[self.pos:self.pos + 12]
                        size = 12
                    decoded = json.loads('"' + escaped + '"')
                    if self.target:
                        output.append(decoded)
                    self.pos += size
                    continue
                elif self.target:
                    output.append(char)
            elif char == '"':
                self.in_string = True
                self.string_start = self.pos
                self.target = self.depth == 1 and self.previous == ':' and self.key == self.field
            elif char in '{[':
                self.depth += 1
                self.previous = char
            elif char in '}]':
                self.depth -= 1
                self.previous = char
                if self.depth == 0:
                    self.mode = "ignore"
                    self.pos += 1
                    break
            elif not char.isspace():
                self.previous = char
            self.pos += 1
        return ''.join(output)
