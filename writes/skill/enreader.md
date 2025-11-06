<!-- date: 2025.04.01 -->
<!-- category: skill -->
<!-- summary: 分享如何用 vue3 vant epubjs 等开发一款带离线翻译功能的英文原著阅读器，其中的前因后果、设计思路、架构选型、关键技术点 -->

# 我开发了一款英文原著阅读器

> 注：本文尽量少贴代码，聚焦思路与功能。如果你只想看仓库代码，请前往 [伊恩阅读器](https://github.com/dominicyuan1024/enreader) 项目。

## 初衷与目标

最近这段时间一直在通过阅读英文原著来学习英文，在阅读过程中遇到不懂的单词，希望能快速点击翻译并记录到生词本,以供后面学习。
但试用了一番市面上的产品，譬如京东读书、蒙哥阅读器等等，都没发给我完美的体验。

1. 功能眼花缭乱，譬如标记单词是不是雅思托福词汇这些，我很讨厌考试，看着就烦。
2. 付费与看广告的居多，体验不好，我自己有书，我就播放一下还要我贡献价值啊？
3. 在学习英语到一定程度时发现只记录单词是没用的，还得记录单词所在的句子，通过积累句子的表达才能学得更好, 但是没找到有这类功能的阅读器。
4. 很多免费的支持 epub 格式的书籍没有带离线翻译功能，我经常在地铁上看书，有时候信号太差，在线翻译要转半天。
5. 那些有离线翻译功能的应用会直接给出中文解释，没法完全沉浸在英文内容里。如果我使用英-英词典，但有时候实在看不懂英文解释还是需要看中文。也就是说，我希望它能先给我英文解释，在我看不懂的时候再提供给我中文解释。

总结一句，市面上的东西不是不能用，但总觉得别扭。
因此我决定从这些产品中挑选一些自己需要的功能，组装了一个纯净版的英文原著阅读器。

关键实现点如下：
- 书架管理
  - 支持导入、删除 epub 格式书籍
- 阅读体验
  - 支持阅读 epub 书籍
  - 目录与定位：根据层级标题生成 TOC 与锚点跳转
  - 进度持久化：滚动/章节进度的记录与恢复
  - 字体与主题：支持设置字体大小、颜色、背景色
  - 标注与笔记：支持单词点选高亮，并自动记录当前句子
  - 翻译：支持离线翻译并隐藏中文解释，支持一键将词典解释加入笔记
- 分享
  - 支持根据笔记生成词云，保存图片
- 离线存储
  - 所有用户设置、笔记、书籍内容不会刷新页面后消失

## 架构与技术选型

- 客户端：单页面 web 应用，轻量，免下载；
- 服务端：暂不需要，只是一个本地阅读器，安安静静地看书；
- 存储与同步：使用 IndexDb 本地存储；我本人不会随意切换浏览器，可先不考虑同步；
- 功能：书架、读书、翻译、笔记、设置
- 前端框架选择了 Vue3 , UI 框架选择了 Vant4
- epub 格式阅读组件选择了 [epubjs](https://www.npmjs.com/package/epubjs/v/0.4.2)
- 翻译功能组件选择了 [mdict-js](https://github.com/fengdh/mdict-js)
- 离线词典选择了 《牛津英汉双语词典 第 10 版》

### 数据表设计

使用 indexDB 作为存储，表设计如下：

```javascript
{
  // 书目：包含书名、封面、作者信息、阅读进度
  bookMeta: '++id, &hash, hashAlg, title, author, cover, progress, utime',
  // 书籍：包含文件名、文件格式、文件大小、文件内容
  bookContent: '++id, &hash, content, filename, format, size, utime',
  // 词典：包含英语词典名称、是否开启使用
  dictMeta: '++id, &hash, hashAlg, title, using, utime',
  // 笔记: 包含单词、读者的备注、单词在书籍中的定位、单词所在的句子、单词的英文解释、单词的中文解释
  bookmark: '++id, bookHash, content, description, cfi, ctx, defEN, defCN, ctime, utime'
}
```

将这些数据表操作封装成单独函数，也方便后续升级可对接后端服务 api
具体代码可查看：[src/db/db.js](https://github.com/dominicyuan1024/enreader/blob/master/src/db/db.js)

还有其余一些用户设置是存储到 localStorage

```javascript
// 书籍的当前阅读进度
localStorage.setItem(`book-cfi-${hash}`, cfi);
// 阅读设置-是否单击标注单词
localStorage.setItem("isHighlightWhenClick", val);
// 阅读设置-风格
localStorage.setItem("book-theme", name);
// 阅读设置-字体大小
localStorage.setItem("book-font-size", val);
// 阅读设置-使用词典
localStorage.setItem(nameDictUsingHash, data);
```

### 书架功能实现

书架管理，属于常见的 文件导入 + 列表增删 交互功能，UI 组件基本都将功能实现了，我只是组合起来并调整样式。
由于实在太常见，没有分享价值，这里就不浪费时间细说了。

具体代码可查看：[src/views/Bookcase.vue](https://github.com/dominicyuan1024/enreader/blob/master/src/views/Bookcase.vue)

出来的效果如图所示：
[书架.jpg](https://github.com/dominicyuan1024/enreader/blob/master/docs/bordered_%E4%B9%A6%E6%9E%B6.jpg)

### 阅读功能实现

阅读功能，这是我从业以来第一次接触 web 书籍阅读功能，花了不少心思。

具体代码可查看：src/views/Book.vue

主要实现了以下功能：
点击书籍时将书籍的 id 写入 url 参数中，跳转到阅读页面路由;
从 indexDB 查询指定的书籍内容，调用 epub.js 加载到页面；
待书籍加载后跳转到指定 cfi，也就是读者上一次阅读的位置;
从 indexDB 中读取单词笔记，将记录的单词高亮展示；
从 epub 对象中获取目录数据渲染为可跳转的目录；
调用 epub 对象方法设置背景颜色、字体颜色、字体大小；
从 indexDB 查询展示这本书的单词笔记，并且支持点击跳转到具体的书籍位置；
上面的功能都有比较多的参考文章，大都是调用 epubjs 的 api 实现，就不再赘述了。

实现效果如图：

[目录.jpg](https://github.com/dominicyuan1024/enreader/blob/master/docs/bordered_%E7%9B%AE%E5%BD%95.jpg)

[设置.jpg](https://github.com/dominicyuan1024/enreader/blob/master/docs/bordered_%E9%A3%8E%E6%A0%BC%E8%AE%BE%E7%BD%AE.jpg)

重点说下这个功能：实现点击单词高亮并且加入笔记功能， 一键操作，简单快捷；
这种点击页面的某个位置，就能将整个单词高亮的功能，我之前还从未接触过，后面经过一番调研，实现如下：

```javascript
import Epub from 'epubjs'

// 页面加载时初始化 epub
ebook = Epub()
ebook.open(res.content, 'binary')
rendition = ebook.renderTo('reading', {
  flow: 'paginated', // 分页模式 'paginated' | 'scrolled'
  // flow: "scrolled-doc",
  manager: 'continuous', // 连续滑屏模式 'continuous' | 'default'
  snap: true, // 是否支持翻页
  width: '100%',
  height: '100%',
  spread: false // 是否显示双页
})

// iframeView 是 epub 渲染所使用的 iframe 对象，这里主要时监听它的点击事件
rendition.hooks.render.register((iframeView) => {
  bookClickHandler = (evt) => {
    selectCursorWord(evt, iframeView);
  };
  iframeView.document.addEventListener("click", bookClickHandler);
})

// 根据点击坐标选取整个单词，这个函数会触发 "selected" 事件
function selectCursorWord(evt, HookIframeView) {
  console.log("selectCursorWord");
  const window = HookIframeView.window;
  const document = HookIframeView.document;
  const x = evt.clientX;
  const y = evt.clientY;

  let offsetNode;
  let offset;

  const sel = window.getSelection();
  sel && sel.removeAllRanges();

  // 关键是浏览器的这个 api , 获取点击的 Dom 元素和字符偏移量
  if (document.caretPositionFromPoint) {
    console.log("selectCursorWord caretPositionFromPoint");
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) {
      return;
    }
    offsetNode = pos.offsetNode;
    offset = pos.offset;
  } else if (document.caretRangeFromPoint) {
    const pos = document.caretRangeFromPoint(x, y);
    console.log("selectCursorWord caretRangeFromPoint", x, y, pos);
    if (!pos) {
      return;
    }
    offsetNode = pos.startContainer;
    offset = pos.startOffset;
  } else {
    console.log("selectCursorWord return");
    return;
  }

  console.log("selectCursorWord off", "nodeType=", offsetNode.nodeType, "offset=", offset);

  if (offsetNode.nodeType !== Node.TEXT_NODE) {
    return;
  }

  // 这里从点击的那个字符开始往两边查找组成单词的字符，譬如大小写字母和 - _
  const textNode = offsetNode;
  const content = textNode.data;
  const head = (content.slice(0, offset).match(/[-_a-zA-Z]+$/i) || [""])[0];
  const tail = (content.slice(offset).match(/^([-_a-zA-Z]+|[\u4e00-\u9fa5])/i) || [""])[0];
  if (head.length <= 0 && tail.length <= 0) {
    return;
  }
  if ((head + tail).trim().length === 0) {
    return;
  }

  // 这里相当于去触发 selected 事件，选中的范围正是那个单词
  const range = document.createRange();
  range.setStart(textNode, offset - head.length);
  range.setEnd(textNode, offset + tail.length);
  const rangeRect = range.getBoundingClientRect();
  const { left, right, top, bottom } = rangeRect;
  const isIn = left <= x && right >= x && top <= y && bottom >= y;
  if (!isIn) {
    return;
  }

  sel.addRange(range);
  return range;
}
```

下面是上面的代码触发了 selected 事件后所执行的高亮逻辑

```javascript
// 一早就监听了 selected 事件
rendition.on("selected", highlightSelected);

function highlightSelected(cfiRange, contents) {
  //  先获取选中的 range 对象，包含的是一个段落
  const selection = contents.window.getSelection();
  if (selection.toString().trim() === "") {
    return;
  }
  const range = selection.getRangeAt(0);
  selection.removeAllRanges();
  const txt = range ? range.toString().trim() : "";
  if (!txt) {
    return;
  }
  const rect = range.getBoundingClientRect();
  const [left, top] = calcRectPosition(rect);
  const exist = markList.findIndex((item) => item.cfi === cfiRange) >= 0;
  if (exist) {
    console.log(`cursorWord ${cfiRange.toString()} already exist`);
    showMarkTool(true, left, top);
    return;
  }

  // 这里 range 包含的是一个段落，从中选取单词所在的句子
  const ctx = getSentenceOfWord(range.commonAncestorContainer.data, range.startOffset, range.endOffset);

  // 将单词笔记写入 indexDB
  DB.putBookmark({
    bookHash,
    cfi: cfiRange,
    content: txt,
    ctx: ctx,
  })
    .then((data) => {
      if (!data) return;
      // 调用 epubjs 的 api 渲染高亮的样式
      rendition.annotations.highlight(cfiRange, {});
      console.log("highlight", cfiRange);
      return markList.push(data);
    })
    .then(() => {
      // 弹出工具栏让用户选择操作
      clickHighLightCfi = cfiRange;
      showMarkTool(true, left, top);
    })
    .catch((err) => console.error("highlight", cfiRange, err));
}
```

最终实现效果如图：
[点击高亮.jpg](https://github.com/dominicyuan1024/enreader/blob/master/docs/bordered_%E9%AB%98%E4%BA%AE%E9%80%89%E4%B8%AD.jpg)

### 翻译功能实现

实现翻译功能时，一开始纠结于是用在线翻译 api 还是用离线翻译，最终综合自己的网络场景，决定还是使用离线翻译，这是兜底的能力，后续还可以在此基础上加上在线翻译甚至 AI 都问题不大。
于是在网上搜索相关的开源框架，发现并不多，很多都是基于 NodeJs 实现的,只适用于服务端使用，最后果断选择了这款 https://github.com/fengdh/mdict-js，还带演示页面。
由于该项目代码没有模块化，手动从源项目里复制粘贴进来整理一下放到了 [src/mdict](https://github.com/dominicyuan1024/enreader/blob/master/src/mdict) 下面。
然后封装成一个 lookup 方法提供使用，具体代码可查看：[src/db/translate.js](https://github.com/dominicyuan1024/enreader/blob/master/src/db/translate.js)

translate.js 里面还有一个方法是用来生成翻译内容的展示页面的,这里可以插入任意的 css 样式文件或者 javascrpt 脚本。

```javascript
export async function generateHtml(content = "", css = "", js = "", style = "") {
  css = css ? css : translatorInfo.css;
  const cssEl = css ? `<link href="${css}" rel="stylesheet">` : "";
  js = js ? js : translatorInfo.js;
  const jsEl = js ? `<script type="text/javascript" async="" src="${js}"></script>` : "";
  const styleEl = style ? `<style type="text/css">${style}</style>` : "";
  content = content ? content : "404 notfound";
  return `
  <html> 
    <head> 
      ${cssEl}
      ${styleEl}
    </head> 
    <body style="margin:0;padding:0;border:0;background:#fff;">
    ${content}
    ${jsEl}
    </body>
  </html>`;
}
```

通过插入的 css 与 javascript，实现了如下三个功能：

1. 实现中文马赛克交互：中文默认用马赛克遮挡，点击可展示，主要原理是使用文字阴影将内容遮挡

   ```css
   /* 马赛克 */
   chn {
     color: transparent !important;
     text-shadow: 0 0 10px rgba(0, 0, 0, 0.5) !important;
   }
   chn * {
     color: transparent !important;
     text-shadow: 0 0 10px rgba(0, 0, 0, 0.5) !important;
   }
   /* 去掉马赛克 */
   chn.selfshow {
     color: initial !important;
     text-shadow: none !important;
   }
   chn.selfshow * {
     color: initial !important;
     text-shadow: none !important;
   }
   ```

2. 实现加入笔记交互：一个英文单词可以有许多意思，点击其中一个解释，可快速将其加入笔记中。

3. 美化词典样式：由于词典里查出来的东西太多了，包括许多示例、词组内容，因此同理将大部分内容默认折叠， 实在感兴趣可点击展开。

具体代码可查看
[public/dict/oxford10/oxford10.css](https://github.com/dominicyuan1024/enreader/blob/master/public/dict/oxford10/oxford10.css)
[public/dict/oxford10/oxford10.js](https://github.com/dominicyuan1024/enreader/blob/master/public/dict/oxford10/oxford10.js)

最终实现效果如图所示：
[翻译.jpg](https://github.com/dominicyuan1024/enreader/blob/master/docs/bordered_%E7%BF%BB%E8%AF%912.jpg)

## 笔记功能

笔记页面除了展示标注的生词，还将展示这个生词所在的句子，以及加入的词典翻译内容
逻辑相对简单，就是从 indexDB 的 bookmark 表中查询数据，渲染到列表，同时给句子中的单词添加下划线重点提示。

```javascript
<p v-html="item.ctx.replace(item.content, `<span class='underline'>${item.content}</span>`)"></p>
```

同时中文解释也是默认使用马赛克遮挡，这一切都是为了沉浸式英文阅读。

具体代码可查看：[src/views/Note.vue](https://github.com/dominicyuan1024/enreader/blob/master/src/views/Note.vue)

最后实现效果如图所示：
[笔记.jpg](https://github.com/dominicyuan1024/enreader/blob/master/docs/bordered_%E7%AC%94%E8%AE%B02.jpg)

### 词云功能实现

使用 echarts 与 echarts-wordcloud 实现，具体配置如下：

```javascript
wordCloudChart = echarts.init(el, null, {
      devicePixelRatio: window.devicePixelRatio
    })
    wordCloudChart.setOption({
      backgroundColor: '#333',
      title: [
        {
          text: `${imgTitle} {big|${data.length}} ${formatDate()}/n${shareUrl}`,
          textStyle: {
            // fontWeight: 'normal',
            fontSize: 10,
            color: '#fff',
            verticalAlign: 'bottom',
            rich: {
              big: {
                fontSize: 20,
                fontWeight: 700,
                color: '#EEA644',
                verticalAlign: 'bottom',
                align: 'bottom',
                padding: [0, 0, 5, 0]
              }
            }
          },
          x: 'center',
          y: 'bottom'
        }
      ],
      series: [
        {
          type: 'wordCloud',
          shape: 'circle',
          keepAspect: false,
          // maskImage: maskImage,
          left: 'center',
          top: 'center',
          width: '90%',
          // height: '100%',
          sizeRange: [22, 42],
          rotationRange: [-70, 90],
          rotationStep: 45,
          gridSize: 1,
          drawOutOfBound: false,
          shrinkToFit: false,
          layoutAnimation: true,
          textStyle: {
            fontFamily: 'sans-serif',
            // fontWeight: 'bold',
            color: function () {
              return (
                'rgb(' +
                [
                  Math.round(Math.random() * 160 + 100),
                  Math.round(Math.random() * 160 + 100),
                  Math.round(Math.random() * 160 + 100)
                ].join(',') +
                ')'
              )
            }
          },
          data
        }
      ]
    })
  } catch (e) {
    console.error(e)
  }
```

具体代码可查看：[src/components/share.vue](https://github.com/dominicyuan1024/enreader/blob/master/src/components/share.vue)

最后实现效果如图所示：
[词云.jpg](https://github.com/dominicyuan1024/enreader/blob/master/docs/bordered_%E8%AF%8D%E4%BA%91%E5%88%86%E4%BA%AB.jpg)

## 结果

最后实际使用过程中，很好的满足了我日常的英文书籍阅读需求，我使用它阅读了十几本英文原著，并且我发现 epub 格式还有许多漫画可以看, 结合 z-lib 这个平台，我实现了阅读自由。

## 下一步计划

1. 离线词典查出来的内容还是太多了，需要读者自己去匹配符合语境的解释，比较烦人，可考虑接入 AI ,根据单词语句更精准直接地给出单词解释，让阅读更流畅。
2. 可接入一些词汇量评估系统或者 AI，在读者一边阅读时，一边根据读者标注的生词和认识的文本内容自动评估读者的词汇量水平，并且记录词汇量增长曲线，以此来量化学习成果。
3. 该阅读器是为了践行"可理解性输入"的英语学习方式，一本书的陌生单词不能太多。可以根据评估出来的读者词汇量水平，分析出某本书不认识的单词有多少，以此给读者阅读建议。
4. 我也很喜欢看漫画，如果能将翻译功能适配漫画，那就美妙了！不用再等待字幕组啦~

---

附：

- 仓库地址：https://github.com/dominicyuan1024/enreader
- 快速试用：https://dominicyuan1024.github.io/enreader