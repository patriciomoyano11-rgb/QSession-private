"""Disabled. This copied production R2 credentials to the production encoder.

Import does not open a socket. Running it fails before Docker or SSH.
"""


def main():
    raise SystemExit('Refusing to read or forward production storage credentials')


if __name__ == '__main__':
    main()
