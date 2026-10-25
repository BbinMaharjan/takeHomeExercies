"use client";

import { Button, Result } from "antd";
import { useRouter } from "next/navigation";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <Result
        status="404"
        title="404"
        subTitle="Sorry, the page or task route you visited does not exist."
        extra={
          <Button type="primary" size="large" onClick={() => router.push("/")}>
            Back Home
          </Button>
        }
      />
    </div>
  );
}
