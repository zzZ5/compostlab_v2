import Image from "next/image";

interface CompostLabLogoProps {
  size?: "small" | "medium" | "large" | "xlarge";
}

export default function CompostLabLogo({ size = "medium" }: CompostLabLogoProps) {
  // Logo 尺寸配置 - 进一步增大尺寸以填满侧边栏
  const sizeConfig = {
    small: { width: 24, height: 24 },
    medium: { width: 48, height: 32 },
    large: { width: 120, height: 64 },  // 进一步大幅增加宽度和高度
    xlarge: { width: 240, height: 90 },  // 登录页面专用超尺寸（large的两倍）
  };

  const config = sizeConfig[size];

  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <Image
        src="/logo-compostlab-rectangle.svg"
        alt="CompostLab Logo"
        width={config.width}
        height={config.height}
        style={{ display: "block" }}
        priority
      />
    </div>
  );
}