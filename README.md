👉👉👉 This extension is still **under development**.

👉👉👉 Latest **VS Code Insiders** is required and at times this extension might be broken.

---

[![Build Status](https://dev.azure.com/jrieken/vscode-github-issue-notebooks/_apis/build/status/microsoft.vscode-github-issue-notebooks?branchName=master)](https://dev.azure.com/jrieken/vscode-github-issue-notebooks/_build/latest?definitionId=1&branchName=master)

# GitHub Issue Notebooks

The VS Code GitHub Issue notebook extension enables you to run issue queries from within VS Code so that queries and results are displayed interleaved - just like in other notebook applications. 

### Getting Started

1. use latest VS Code Insiders
1. install the latest version of this extension (https://github.com/microsoft/vscode-github-issue-notebooks/releases)
1. create a `foo.github-issues` file and you are all set

![Sample](https://raw.githubusercontent.com/microsoft/vscode-github-issue-notebooks/master/sample.png)

### Features

The following features are currently supported

* Querying and rendering of GH issues and PR queries
* Language Support
  * syntax highlighting
  * validation
  * completions
  * code navigation (find references, to go definition)
  * rename
  * formatting

### Query Syntax

This extension supports to search for issues and pull requests using GitHub search queries (https://help.github.com/en/github/searching-for-information-on-github/searching-issues-and-pull-requests). In addition, variables can be defined and OR-queries can be used. Approximation of the grammer:

```
doc ::= query | or | def
query ::= <GH_QUERY> ('sort asc by' | 'sort desc by' <GH_SORT>)?
or ::= query "OR" query | or
def ::= var "=" query
var ::= "$" [_a-zA-Z] [_a-zA-Z0-9]*
```

Note that new line characters always terminate an expression.
