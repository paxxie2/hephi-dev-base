# P10 Dubbo 离线构建环境：实测记录（2026-11-07）

本记录只验证构建环境与离线执行能力，**不构成 P10 完成**：三个候选任务、各自参考修复与 base 失败负例尚未选定，平台侧 Dubbo 项目检查配置仍未接入。

## 1. 环境（实读）

| 项 | 值 | 复核命令 |
| --- | --- | --- |
| Java | OpenJDK 17.0.18（另有 Homebrew JDK 23 可用） | `java -version` |
| Maven | Apache Maven 3.9.9 | `mvn -version` |
| 本地依赖仓库 | `~/.m2/repository` 约 5.4 GB | `du -sh ~/.m2/repository` |
| Dubbo 源码 | `/Users/zm/workspace/app/dubbo`，分支 `fix-some-bug-about-proto`，HEAD `42bd630514371db37b09afb36dae7190a82662d6` | `git -C ... log -1` |

## 2. 离线编译实测

```bash
cd /Users/zm/workspace/app/dubbo
mvn -o -B -pl dubbo-common -am -DskipTests -Dmaven.javadoc.skip=true \
  -Dcheckstyle.skip=true -Drat.skip=true -Dmaven.source.skip=true compile
```

结果：`BUILD SUCCESS`，Total time 6.969s，EXIT=0（`-o` 强制离线，未回退在线下载）。

## 3. 离线测试实测

```bash
mvn -o -B -pl dubbo-common -Dtest=StringUtilsTest -DfailIfNoTests=false test
```

结果：`Tests run: 37, Failures: 0, Errors: 0, Skipped: 0`，`BUILD SUCCESS`，EXIT=0。

## 4. 结论与缺口

- 已证明：固定 JDK 17 + Maven 3.9.9 + 现有本地仓库可以**离线**完成编译并运行既有单元测试；离线时缺少依赖会显式失败而不是回退在线。
- 未完成（P10 仍 blocked）：
  1. 三个候选任务（含固定参考修复、相关行为测试、明确 base）尚未选定；
  2. base 失败 → 参考修复通过的正反验证未做（需要候选任务，不能凭空构造）；
  3. 实验宿主 B 没有 Dubbo 的项目检查配置（`experiment/project-config` 仅 `site-pnl-checks.json`），hephi 激活的任务在 prepare 阶段会阻塞；
  4. 计划并发下的资源（磁盘/内存/CPU）未测量。
- 下一步建议：选定 3 个最小 Dubbo 缺陷（本仓库 `fix-some-bug-about-proto` 分支可作参考），补 `dubbo-checks.json` 检查配置，然后再跑正反例。
