import os
import time
from openai import AsyncOpenAI

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


class BaseAgent:
    def __init__(self, system_prompt):
        api_key = os.getenv("OPENAI_API_KEY")
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        model = os.getenv("OPENAI_MODEL", "gpt-5")
        timeout = float(os.getenv("OPENAI_TIMEOUT", "60"))

        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY is not set. Please configure it in environment variables or a .env file."
            )

        self.client = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout
        )
        self.model = model
        self.system_prompt = system_prompt

    async def run(self, features, rules=None):
        content = {
            "features": features,
            "rules": rules
        }

        current_time = time.strftime('%H:%M:%S') + f'.{int(time.time() * 1000) % 1000:03d}'
        print(f"[{current_time}] Agent {id(self)} started request")

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "/no_think" + self.system_prompt},
                {"role": "user", "content": str(content)}
            ]
        )

        current_time = time.strftime('%H:%M:%S') + f'.{int(time.time() * 1000) % 1000:03d}'
        print(f"[{current_time}] Agent {id(self)} finished request")

        return response.choices[0].message.content