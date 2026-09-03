export default {
  rules: {
    'header-max-length': [2, 'always', 100],
    'header-trim': [2, 'always'],
    'subject-empty': [2, 'never'],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'type-enum': [2, 'always', ['feat', 'fix', 'refactor', 'test', 'docs', 'chore', 'ci', 'build']],
  },
};
