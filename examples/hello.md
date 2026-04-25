You are a cmdx-powered command. Run the hello script and handle the yield protocol.

## Steps

1. Run `cmdx run hello` and parse the JSON output
2. If the output contains a `yield`, respond to the prompt and resume:
   - `cmdx resume <session> --answer="<your response>"`
3. If the output contains `done`, report the summary to the user
4. On error, report the error message
