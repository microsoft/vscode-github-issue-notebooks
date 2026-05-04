// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['**/src/*/vscode.d.ts', '**/src/*/vscode.proposed*.d.ts', 'out/', 'dist/'],
	},
	{
		files: ['src/**/*.ts'],
		plugins: {
			'@typescript-eslint': tseslint.plugin,
		},
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				ecmaVersion: 6,
				sourceType: 'module',
			},
		},
		rules: {
			'constructor-super': 'warn',
			'curly': 'warn',
			'eqeqeq': 'warn',
			'no-caller': 'warn',
			'no-debugger': 'warn',
			'no-duplicate-case': 'warn',
			'no-duplicate-imports': 'warn',
			'no-eval': 'warn',
			'no-extra-semi': 'warn',
			'no-new-wrappers': 'warn',
			'no-sparse-arrays': 'warn',
			'no-throw-literal': 'warn',
			'no-unsafe-finally': 'warn',
			'no-unused-labels': 'warn',
			'no-var': 'warn',
		},
	}
);
