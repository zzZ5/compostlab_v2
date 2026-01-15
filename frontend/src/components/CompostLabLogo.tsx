import Image from "next/image";

interface CompostLabLogoProps {
  size?: "small" | "medium" | "large" | "xlarge";
}

export default function CompostLabLogo({ size = "medium" }: CompostLabLogoProps) {
  // Logo 尺寸配置
  const sizeConfig = {
    small: { width: 40, height: 40 },
    medium: { width: 48, height: 32 },
    large: { width: 120, height: 64 },
    xlarge: { width: 240, height: 90 },
  };

  const config = sizeConfig[size];
  const isSmall = size === "small";

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Image
        src={isSmall ? "/logo-compostlab-circle.svg" : "/logo-compostlab-rectangle.svg"}
        alt="CompostLab Logo"
        width={config.width}
        height={config.height}
        style={{ display: "block" }}
        priority
      />
    </div>
  );
}