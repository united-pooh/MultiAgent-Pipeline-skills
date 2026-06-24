#!/usr/bin/env python3
"""
Approximate Python Cognitive Complexity reproducer for Better Highlights.

This script does not decompile or copy Better Highlights. It implements a
Sonar-style approximation from public Cognitive Complexity rules and the local
plugin metadata observed in this workspace.
"""

from __future__ import annotations

import argparse
import ast
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


DEFAULT_EXCLUDED_DIRS = frozenset(
    {
        ".git",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".venv",
        "__pycache__",
        "build",
        "dist",
        "venv",
    }
)

FUNCTION_REPORT_COLUMNS = (
    "function",
    "loop_points",
    "if_points",
    "logical_points",
    "other_points",
    "total_points",
)

MATCH_NODE = getattr(ast, "Match", None)


@dataclass
class Contribution:
    line: int
    kind: str
    points: int
    nesting: int
    note: str


@dataclass
class FunctionScore:
    name: str
    line: int
    score: int
    level: str
    contributions: list[Contribution] = field(default_factory=list)


@dataclass
class FunctionReportRow:
    path: Path
    name: str
    loop_points: int
    if_points: int
    logical_points: int
    other_points: int
    total_points: int


class CognitiveScorer:
    """Sonar-style cognitive complexity approximation for one Python function."""

    def __init__(
        self,
        function_name: str,
        include_nested_functions: bool = True,
        count_loop_else: bool = False,
    ) -> None:
        self.function_name = function_name
        self.include_nested_functions = include_nested_functions
        self.count_loop_else = count_loop_else
        self.contributions: list[Contribution] = []

    def score(self, node: ast.AST) -> int:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            raise TypeError(f"expected function-like node, got {type(node).__name__}")
        body = node.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) else [node.body]
        self._visit_statements(body, nesting=0)
        return sum(item.points for item in self.contributions)

    def _add(self, node: ast.AST, kind: str, points: int, nesting: int, note: str) -> None:
        if points <= 0:
            return
        self.contributions.append(
            Contribution(
                line=getattr(node, "lineno", 0),
                kind=kind,
                points=points,
                nesting=nesting,
                note=note,
            )
        )

    def _structural(self, node: ast.AST, kind: str, nesting: int, note: str) -> None:
        self._add(node, kind, 1 + nesting, nesting, note)

    def _fundamental(self, node: ast.AST, kind: str, note: str) -> None:
        self._add(node, kind, 1, 0, note)

    def _visit_statements(self, statements: Iterable[ast.stmt], nesting: int) -> None:
        for statement in statements:
            self._visit(statement, nesting)

    def _visit(self, node: ast.AST, nesting: int) -> None:
        if isinstance(node, ast.If):
            self._visit_if(node, nesting, is_elif=False)
        elif isinstance(node, (ast.For, ast.AsyncFor, ast.While)):
            self._structural(node, type(node).__name__, nesting, "loop breaks linear flow")
            self._visit_expression(getattr(node, "test", None), nesting)
            self._visit_expression(getattr(node, "iter", None), nesting)
            self._visit_statements(node.body, nesting + 1)
            if self.count_loop_else:
                self._visit_else_body(node.orelse, nesting + 1)
            else:
                self._visit_statements(node.orelse, nesting + 1)
        elif isinstance(node, ast.Try):
            self._visit_statements(node.body, nesting)
            for handler in node.handlers:
                self._structural(handler, "ExceptHandler", nesting, "except/catch branch")
                self._visit_expression(handler.type, nesting)
                self._visit_statements(handler.body, nesting + 1)
            self._visit_else_body(node.orelse, nesting)
            self._visit_statements(node.finalbody, nesting)
        elif MATCH_NODE is not None and isinstance(node, MATCH_NODE):
            self._structural(node, "Match", nesting, "match/switch-like flow break")
            self._visit_expression(node.subject, nesting)
            for case in node.cases:
                self._visit_expression(case.guard, nesting + 1)
                self._visit_statements(case.body, nesting + 1)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            if self.include_nested_functions:
                nested_body = node.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) else [node.body]
                self._visit_statements(nested_body, nesting + 1)
        else:
            self._generic_visit(node, nesting)

    def _visit_if(self, node: ast.If, nesting: int, is_elif: bool) -> None:
        if is_elif:
            self._fundamental(node, "Elif", "elif continues an if chain")
        else:
            self._structural(node, "If", nesting, "if breaks linear flow")
        self._visit_expression(node.test, nesting)
        self._visit_statements(node.body, nesting + 1)

        if len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If):
            self._visit_if(node.orelse[0], nesting, is_elif=True)
        else:
            if node.orelse:
                self._fundamental(node.orelse[0], "Else", "else branch")
            self._visit_statements(node.orelse, nesting + 1)

    def _visit_else_body(self, statements: list[ast.stmt], nesting: int) -> None:
        if statements:
            self._fundamental(statements[0], "Else", "loop/try else branch")
        self._visit_statements(statements, nesting)

    def _visit_expression(self, node: ast.AST | None, nesting: int) -> None:
        if node is not None:
            self._visit(node, nesting)

    def _generic_visit(self, node: ast.AST, nesting: int) -> None:
        if isinstance(node, ast.IfExp):
            self._structural(node, "IfExp", nesting, "conditional expression")
            self._visit(node.test, nesting)
            self._visit(node.body, nesting + 1)
            self._visit(node.orelse, nesting + 1)
            return

        if isinstance(node, ast.BoolOp):
            self._score_bool_sequence(node)
            for value in node.values:
                self._visit_bool_operand(value, nesting)
            return

        if isinstance(node, ast.Call):
            if self._is_recursive_call(node):
                self._fundamental(node, "Recursion", "direct self-recursive call")
            self._visit(node.func, nesting)
            for arg in node.args:
                self._visit(arg, nesting)
            for keyword in node.keywords:
                self._visit(keyword.value, nesting)
            return

        for child in ast.iter_child_nodes(node):
            self._visit(child, nesting)

    def _score_bool_sequence(self, node: ast.BoolOp) -> None:
        operators = self._flatten_bool_ops(node)
        if not operators:
            return
        points = 1
        for previous, current in zip(operators, operators[1:]):
            if previous is not current:
                points += 1
        op_names = "/".join("and" if op is ast.And else "or" for op in operators)
        self._add(node, "LogicalOperatorSequence", points, 0, f"boolean operator sequence: {op_names}")

    def _visit_bool_operand(self, node: ast.AST, nesting: int) -> None:
        if isinstance(node, ast.BoolOp):
            for value in node.values:
                self._visit_bool_operand(value, nesting)
        else:
            self._visit(node, nesting)

    def _flatten_bool_ops(self, node: ast.AST) -> list[type[ast.boolop]]:
        if not isinstance(node, ast.BoolOp):
            return []
        result: list[type[ast.boolop]] = []
        op_type = type(node.op)
        for value in node.values:
            result.append(op_type)
            result.extend(self._flatten_bool_ops(value))
        return result[1:]

    def _is_recursive_call(self, node: ast.Call) -> bool:
        func = node.func
        if isinstance(func, ast.Name):
            return func.id == self.function_name
        if isinstance(func, ast.Attribute):
            return func.attr == self.function_name
        return False


class FunctionCollector(ast.NodeVisitor):
    def __init__(self) -> None:
        self.stack: list[str] = []
        self.functions: list[tuple[str, ast.FunctionDef | ast.AsyncFunctionDef]] = []

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.stack.append(node.name)
        for statement in node.body:
            self.visit(statement)
        self.stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._record(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._record(node)

    def _record(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        name = ".".join([*self.stack, node.name])
        self.functions.append((name, node))
        self.stack.append(node.name)
        for statement in node.body:
            self.visit(statement)
        self.stack.pop()


def classify(score: int, medium_threshold: int, high_threshold: int) -> str:
    if score >= high_threshold:
        return "high"
    if score >= medium_threshold:
        return "medium"
    return "low"


def analyze_file(
    path: Path,
    medium_threshold: int,
    high_threshold: int,
    include_nested_functions: bool,
    count_loop_else: bool = False,
) -> list[FunctionScore]:
    tree = ast.parse(path.read_text(), filename=str(path))
    collector = FunctionCollector()
    collector.visit(tree)
    results: list[FunctionScore] = []
    for qualified_name, function in collector.functions:
        scorer = CognitiveScorer(
            function.name,
            include_nested_functions=include_nested_functions,
            count_loop_else=count_loop_else,
        )
        score = scorer.score(function)
        results.append(
            FunctionScore(
                name=qualified_name,
                line=function.lineno,
                score=score,
                level=classify(score, medium_threshold, high_threshold),
                contributions=scorer.contributions,
            )
        )
    return results


def contribution_bucket(contribution: Contribution) -> str:
    if contribution.kind in {"For", "AsyncFor", "While"}:
        return "loop"
    if contribution.kind in {"If", "Elif", "IfExp"}:
        return "if"
    if contribution.kind == "LogicalOperatorSequence":
        return "logical"
    return "other"


def function_report_row(path: Path, score: FunctionScore) -> FunctionReportRow:
    buckets = {"loop": 0, "if": 0, "logical": 0, "other": 0}
    for contribution in score.contributions:
        buckets[contribution_bucket(contribution)] += contribution.points
    return FunctionReportRow(
        path=path,
        name=score.name,
        loop_points=buckets["loop"],
        if_points=buckets["if"],
        logical_points=buckets["logical"],
        other_points=buckets["other"],
        total_points=score.score,
    )


def iter_python_files(path: Path, excluded_dirs: frozenset[str] = DEFAULT_EXCLUDED_DIRS) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix == ".py" else []
    if not path.is_dir():
        raise FileNotFoundError(path)

    files: list[Path] = []
    for candidate in path.rglob("*.py"):
        relative_parts = candidate.relative_to(path).parts[:-1]
        if any(part in excluded_dirs for part in relative_parts):
            continue
        files.append(candidate)
    return sorted(files)


def analyze_path(
    path: Path,
    medium_threshold: int,
    high_threshold: int,
    include_nested_functions: bool,
    count_loop_else: bool = False,
    excluded_dirs: frozenset[str] = DEFAULT_EXCLUDED_DIRS,
) -> list[FunctionReportRow]:
    root = path if path.is_dir() else path.parent
    rows: list[FunctionReportRow] = []
    for file_path in iter_python_files(path, excluded_dirs=excluded_dirs):
        scores = analyze_file(
            file_path,
            medium_threshold=medium_threshold,
            high_threshold=high_threshold,
            include_nested_functions=include_nested_functions,
            count_loop_else=count_loop_else,
        )
        display_path = file_path.relative_to(root)
        rows.extend(function_report_row(display_path, score) for score in scores)
    return sorted(rows, key=lambda item: (-item.total_points, str(item.path), item.name))


def to_jsonable(path: Path, scores: list[FunctionScore]) -> dict[str, object]:
    return {
        "file": str(path),
        "metric": "better-highlights-like cognitive complexity approximation",
        "functions": [
            {
                "name": item.name,
                "line": item.line,
                "score": item.score,
                "level": item.level,
                "contributions": [
                    {
                        "line": contribution.line,
                        "kind": contribution.kind,
                        "points": contribution.points,
                        "nesting": contribution.nesting,
                        "note": contribution.note,
                    }
                    for contribution in item.contributions
                ],
            }
            for item in scores
        ],
    }


def print_table(path: Path, scores: list[FunctionScore], show_details: bool) -> None:
    print(f"{path}")
    print(f"{'line':>5}  {'score':>5}  {'level':<6}  function")
    print("-" * 72)
    for item in scores:
        print(f"{item.line:>5}  {item.score:>5}  {item.level:<6}  {item.name}")
        if show_details:
            for contribution in item.contributions:
                print(
                    f"       +{contribution.points:<2} line {contribution.line:<4} "
                    f"{contribution.kind:<24} {contribution.note}"
                )


def report_rows_to_jsonable(path: Path, rows: list[FunctionReportRow]) -> dict[str, object]:
    return {
        "path": str(path),
        "metric": "better-highlights-like cognitive complexity approximation",
        "columns": list(FUNCTION_REPORT_COLUMNS),
        "functions": [
            {
                "function": f"{item.path}:{item.name}",
                "loop_points": item.loop_points,
                "if_points": item.if_points,
                "logical_points": item.logical_points,
                "other_points": item.other_points,
                "total_points": item.total_points,
            }
            for item in rows
        ],
    }


def format_function_report(rows: list[FunctionReportRow], include_header: bool = True) -> str:
    lines: list[str] = []
    if include_header:
        lines.append("\t".join(FUNCTION_REPORT_COLUMNS))
    for item in rows:
        lines.append("\t".join([
            f"{item.path}:{item.name}",
            str(item.loop_points),
            str(item.if_points),
            str(item.logical_points),
            str(item.other_points),
            str(item.total_points),
        ]))
    return "\n".join(lines)


def print_function_report(rows: list[FunctionReportRow], include_header: bool = True) -> None:
    output = format_function_report(rows, include_header=include_header)
    if output:
        print(output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="Python source file or directory to analyze")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument("--details", action="store_true", help="show contribution details")
    parser.add_argument("--medium", type=int, default=15, help="medium complexity threshold")
    parser.add_argument("--high", type=int, default=25, help="high complexity threshold")
    parser.add_argument(
        "--exclude-nested-functions",
        action="store_true",
        help="do not include nested function bodies in the enclosing function score",
    )
    parser.add_argument(
        "--count-loop-else",
        action="store_true",
        help="count Python for/while else as an extra branch; disabled by default pending black-box calibration",
    )
    parser.add_argument(
        "--function-report",
        action="store_true",
        help=(
            "emit a sorted TSV report: "
            "function loop_points if_points logical_points other_points total_points"
        ),
    )
    parser.add_argument(
        "--include-default-excluded-dirs",
        action="store_true",
        help="include common cache, build, and virtualenv directories during recursive directory scans",
    )
    parser.add_argument(
        "--no-header",
        action="store_true",
        help="omit column headers in function report text output",
    )
    args = parser.parse_args()

    if args.path.is_dir() or args.function_report:
        excluded_dirs = frozenset() if args.include_default_excluded_dirs else DEFAULT_EXCLUDED_DIRS
        rows = analyze_path(
            args.path,
            medium_threshold=args.medium,
            high_threshold=args.high,
            include_nested_functions=not args.exclude_nested_functions,
            count_loop_else=args.count_loop_else,
            excluded_dirs=excluded_dirs,
        )
        if args.json:
            print(json.dumps(report_rows_to_jsonable(args.path, rows), ensure_ascii=False, indent=2))
        else:
            print_function_report(rows, include_header=not args.no_header)
        return 0

    scores = analyze_file(
        args.path,
        medium_threshold=args.medium,
        high_threshold=args.high,
        include_nested_functions=not args.exclude_nested_functions,
        count_loop_else=args.count_loop_else,
    )
    if args.json:
        print(json.dumps(to_jsonable(args.path, scores), ensure_ascii=False, indent=2))
    else:
        print_table(args.path, scores, show_details=args.details)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
