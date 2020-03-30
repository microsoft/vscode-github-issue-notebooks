# GitHub Issue Notebooks

The VS Code GitHub Issue notebook extension enables you to run issue queries from within VS Code so that queries and results are displayed interleaved - just like in other notebook applications. The query syntax supports variables and OR-quries.

![Sample](https://github.com/microsoft/vscode-github-issue-notebooks/blob/master/sample.png)

### Features

The following features are currently supported

* Querying and rendering of GH issues and PR queries
* Language Support
  * syntax highlighting
  * validation
  * completions
  * code navigation (find references, to go definition)
  * rename 

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


