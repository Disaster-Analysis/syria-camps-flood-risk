require([
  "esri/config",
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/GeoJSONLayer",
  "esri/layers/ImageryTileLayer", // استدعاء وحدة قراءة الـ GeoTIFF [1]
  "esri/layers/GraphicsLayer", 
  "esri/Graphic", 
  "esri/geometry/geometryEngine", 
  "esri/widgets/Measurement" // أداة القياس الجغرافي [1]
], function(esriConfig, Map, MapView, GeoJSONLayer, ImageryTileLayer, GraphicsLayer, Graphic, geometryEngine, Measurement) {

    // تفعيل الـ API Key الخاص بك لـ ArcGIS
    esriConfig.apiKey = "AAPTapObbKBvMt3z4RRzSiiIIgg..jHtKbd_k8YFwoBG0XEdBYCreZGtAoJb86oD8N6PBfjJdma2DfiG2NSQ2deizhZU4JLFnEY7D4QLaKKWzqxoR83oTpIt_kooPew5nWHAbA-AsHiZvsp47wU8_Ehv3yoFwBYlufeRL2PYj8H-eigWhbmfkD8zuS65ySZEel1o1jKvcxqtHRBNuLPpgepkNblRndc6VvXy2naXd9ABEUc1v0nA4tbRXliYxhZk3R-cyIC3yt6FAP9dbot5x6OXOxQk7RvkzAT1_BHP2vK56";

    const map = new Map({
        basemap: "osm" // خريطة الأساس الرسمية [1]
    });

    const syriaExtent = {
        type: "extent",
        xmin: 35.0,
        ymin: 32.3,
        xmax: 42.4,
        ymax: 37.5,
        spatialReference: { wkid: 4326 }
    };

    const view = new MapView({
        container: "viewDiv",
        map: map,
        center: [36.9, 36.1], // تركيز الرؤية الافتراضي ليكون قريباً من المخيمات بشمال غرب سوريا
        zoom: 9,
        constraints: {
            geometry: syriaExtent,
            minZoom: 6,
            maxZoom: 20, // تفعيل الزووم الأقصى لمراقبة الخيام بدقة متناهية! [1]
            rotationEnabled: false
        }
    });

    // ترحيل أزرار الزوم لأسفل اليمين [1]
    view.ui.move("zoom", "bottom-right");

    // 📐 تفعيل أداة القياس الجغرافي [1]
    const measurementWidget = new Measurement({
        view: view,
        activeTool: null 
    });
    view.ui.add(measurementWidget, "top-left"); // عرض الأداة أعلى اليسار [1]

    // تعريف متغيرات جميع الطبقات والبيانات الإدارية والسكانية المطلوبة
    let waterLineLayer, admin1Layer, idpSitesLayer, damageTiffLayer;
    let isCoordToolActive = false;
    let clickListenerHandle = null;

    // قوالب الـ Popups المخصصة والذكية للمخيمات بناءً على هيكلية الملف الجديد [3]
    const admin1PopupTemplate = {
        title: "تفاصيل المحافظة: {adm1_name1} ({adm1_name})",
        content: `
            <table class="esri-widget__table" style="width: 100%; border-collapse: collapse; font-family: Segoe UI, sans-serif; font-size: 13px;">
                <tr style="background-color: #f7fafc;"><td style="padding: 8px; font-weight: bold; width: 45%;">الرمز الإداري:</td><td style="padding: 8px;">{adm1_pcode}</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">الدولة:</td><td style="padding: 8px;">{adm0_name1}</td></tr>
                <tr style="background-color: #f7fafc;"><td style="padding: 8px; font-weight: bold;">المساحة التقريبية:</td><td style="padding: 8px;">{area_sqkm} كم²</td></tr>
            </table>
        `
    };

    const idpPopupTemplate = {
        title: "⛺ مخيم النازحين: {Site_name}", // اسم الموقع والرمز من ملفك بدقة! [3]
        content: `
            <table class="esri-widget__table" style="width: 100%; border-collapse: collapse; font-family: Segoe UI, sans-serif; font-size: 13px;">
                <tr style="background-color: #f7fafc;"><td style="padding: 8px; font-weight: bold; width: 45%;">تعداد النازحين بالموقع:</td><td style="padding: 8px; font-weight: bold; color: #1a365d;">{Total_IDPs} نسمة</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">مستوى الخطورة / الضعف:</td><td style="padding: 8px; font-weight: bold; color: #dc2626;">{Category}</td></tr>
                <tr style="background-color: #edf2f7;"><td style="padding: 8px; font-weight: bold;">نوع الموقع:</td><td style="padding: 8px;">{Site_type}</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">المنطقة والمحافظة:</td><td style="padding: 8px;">{District} - {Governorate}</td></tr>
                <tr style="background-color: #f7fafc;"><td style="padding: 8px; font-weight: bold;">البلدية والناحية:</td><td style="padding: 8px;">{Community} - {Subdistrict}</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">الرمز التعريفي P_CODE:</td><td style="padding: 8px;">{P_CODE}</td></tr>
            </table>
        `
    };

    // 1. تحميل طبقة حدود المحافظات (Admin 1)
    admin1Layer = new GeoJSONLayer({
        url: "syr_admin1.geojson",
        visible: false,
        outFields: ["*"],
        popupTemplate: admin1PopupTemplate,
        renderer: {
            type: "simple",
            symbol: {
                type: "simple-fill",
                color: [139, 92, 246, 0.05],
                outline: { color: [139, 92, 246, 0.8], width: 1.5 }
            }
        }
    });
    map.add(admin1Layer);

    // 2. تحميل طبقة مجاري وتجمعات المياه الجديدة [3]
    waterLineLayer = new GeoJSONLayer({
        url: "Waterways.geojson", 
        visible: true, 
        renderer: {
            type: "simple",
            symbol: {
                type: "simple-line",
                color: [14, 165, 233, 0.45], // خطوط مائية تركوازية رفيعة وناعمة جداً [1]
                width: "0.8px" // سمك خفيف جداً
            }
        }
    });
    map.add(waterLineLayer);

    // 3. تحميل مضلع الراستر وصور الأضرار (تلوين ذكي متوهج، مع إخفاء وتلاشي البكسلات صفرية القيمة!) [1, 3]
    try {
        damageTiffLayer = new ImageryTileLayer({
            url: "Damage Index Density.tif", 
            visible: false, 
            opacity: 0.8,
            // 🚨 الفلتر الذكي والمطور: يمسح البكسلات الخلفية صفرية القيمة تماماً، ويجعلها شفافة 100%! [1, 3]
            pixelFilter: function(pixelData) {
                if (pixelData && pixelData.pixelBlock) {
                    const pixels = pixelData.pixelBlock.pixels[0];
                    const numPixels = pixels.length;
                    
                    // استخراج القيم الصغرى والعظمى لتدريج الألوان [3]
                    let min = Infinity, max = -Infinity;
                    for (let i = 0; i < numPixels; i++) {
                        if (pixels[i] < min) min = pixels[i];
                        if (pixels[i] > max) max = pixels[i];
                    }
                    if (max === min) max = min + 1; // تفادي القسمة على صفر
                    
                    // تحضير مصفوفات الألوان الفيكتورية للـ Canvas [3]
                    const r = new Uint8Array(numPixels);
                    const g = new Uint8Array(numPixels);
                    const b = new Uint8Array(numPixels);
                    const a = new Uint8Array(numPixels);
                    
                    for (let i = 0; i < numPixels; i++) {
                        // تطبيع القيم من 0.0 إلى 1.0 لسهولة التدريج العشري
                        const t = (pixels[i] - min) / (max - min); 
                        
                        // 🚨 بكسلات الخلايا المظلمة (الخلفية وقيمة 0) نجعل شفافيتها صفراً بالكامل لإلغاء الصندوق الأسود! [1]
                        if (t < 0.15) {
                            r[i] = 0;
                            g[i] = 0;
                            b[i] = 0;
                            a[i] = 0; // شفافة بالكامل [1]
                        } else if (t < 0.6) {
                            // تدرج برتقالي ناري رائع للخطر المتوسط
                            const factor = (t - 0.15) / 0.45;
                            r[i] = 249; // برتقالي R
                            g[i] = 115; // برتقالي G
                            b[i] = 22;  // برتقالي B
                            a[i] = Math.round(factor * 160); // زيادة الكثافة تدريجياً
                        } else {
                            // تدرج أحمر داكن لبؤر الدمار الشديد
                            const factor = (t - 0.6) / 0.4;
                            r[i] = Math.round(249 - factor * 29); // التدرج للوصول للأحمر 220
                            g[i] = Math.round(115 - factor * 77); // التدرج لـ 38
                            b[i] = Math.round(22 + factor * 16);  // التدرج لـ 38
                            a[i] = Math.round(160 + factor * 95); // قوة الإشعاع والألوان
                        }
                    }
                    
                    // إرسال البيانات الملونة والمعدلة بنجاح لخريطة ArcGIS! [3]
                    pixelData.pixelBlock.pixels = [r, g, b, a];
                    pixelData.pixelBlock.pixelType = "U8";
                }
            }
        });
        map.add(damageTiffLayer);
        console.log("تم تحميل وتلوين طبقة الأضرار TIF بنجاح!");
    } catch (e) {
        console.warn("عطل في قراءة ملف الـ TIF:", e);
    }

    // 4. قراءة ملف مخيمات النازحين (🏥 حل تداخل الإحداثيات المتعارضة UTM، والتلوين التفاعلي للمثلثات الكلاسيكية!) [3]
    fetch("IDP Sites.geojson")
      .then(res => res.json())
      .then(data => {
          // 🚨 1. مسح الـ CRS المتعارض لكي تتقبل خريطة ArcGIS الملف فوراً! [1, 3]
          delete data.crs; 

          // 🚨 2. استبدال الإحداثيات المترية الخاطئة بإحداثيات الـ WGS84 المخزنة بداخل خصائص ملفك! [3]
          data.features.forEach(f => {
              if (f.properties && f.properties.Longitude && f.properties.Latitude) {
                  f.geometry.coordinates = [
                      parseFloat(f.properties.Longitude),
                      parseFloat(f.properties.Latitude)
                  ];
              }
          });
          
          // تحويل الـ JSON المعدل إلى Blob URL ليتم قراءته بسلاسة في خريطة ArcGIS [3]
          const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
          const blobUrl = URL.createObjectURL(blob);
          
          // إنشاء طبقة المخيمات تفاعلياً وتلوينها جغرافياً على شكل مثلثات (خيام نازحين) حسب مستوى الخطر [3, 4]
          idpSitesLayer = new GeoJSONLayer({
              url: blobUrl,
              outFields: ["*"],
              popupTemplate: idpPopupTemplate,
              renderer: {
                  type: "unique-value",
                  field: "Category", // الفلترة الملونة حسب مستوى الكارثة والخطورة [3]
                  defaultSymbol: {
                      type: "simple-marker",
                      style: "triangle", // مضلع مثلثي يحاكي شكل الخيمة الإغاثية بدقة بطلبك الفني الممتاز! [4]
                      color: [245, 158, 11, 0.85], // برتقالي افتراضي
                      size: "8px",
                      outline: { color: [255, 255, 255, 0.9], width: 1 }
                  },
                  uniqueValueInfos: [
                      // تلوين وتكبير المثلثات حسب مستوى الخطورة الإنسانية [3, 4]
                      { value: "Catastrophic", symbol: { type: "simple-marker", style: "triangle", color: [153, 27, 27, 0.95], size: "15px", outline: { color: [255, 255, 255, 1], width: 1.5 } } },
                      { value: "catastrophic", symbol: { type: "simple-marker", style: "triangle", color: [153, 27, 27, 0.95], size: "15px", outline: { color: [255, 255, 255, 1], width: 1.5 } } },
                      { value: "Extreme", symbol: { type: "simple-marker", style: "triangle", color: [220, 38, 38, 0.95], size: "12px", outline: { color: [255, 255, 255, 1], width: 1.2 } } },
                      { value: "extreme", symbol: { type: "simple-marker", style: "triangle", color: [220, 38, 38, 0.95], size: "12px", outline: { color: [255, 255, 255, 1], width: 1.2 } } },
                      { value: "Severe", symbol: { type: "simple-marker", style: "triangle", color: [234, 88, 12, 0.9], size: "10px", outline: { color: [255, 255, 255, 1], width: 1 } } },
                      { value: "severe", symbol: { type: "simple-marker", style: "triangle", color: [234, 88, 12, 0.9], size: "10px", outline: { color: [255, 255, 255, 1], width: 1 } } }
                  ]
              }
          });
          map.add(idpSitesLayer);
          
          // استخلاص وحفظ المعالم في الذاكرة لتتلقى عمليات تجميع البيانات [3]
          idpSitesLayer.queryFeatures().then(function(results) {
              loadedPopulatedFeatures = results.features;
              
              // 🚨 3. بناء وتعبئة قائمة المحافظات بمربعات صح ديناميكياً لتطابق شكل الفلترة الكلاسيكي! [1.1.7, 3]
              populateGovernorateChecklist(loadedPopulatedFeatures);

              // بناء مستويات الخطورة كمربعات صح تلقائياً
              populateCategoryChecklist();

              // بناء جدول إحصاءات الخطورة التفاعلي ديناميكياً [3]
              calculateDynamicRiskStats(loadedPopulatedFeatures);
          });

          setupInteractivity();
      }).catch(err => {
          console.error("خطأ في معالجة إحداثيات ملف المخيمات أو قراءته:", err);
          setupInteractivity();
      });

    // 🗺️ دالة بناء خيارات المحافظات كمربعات اختيار (Checkboxes) ديناميكياً [3]
    function populateGovernorateChecklist(features) {
        const govListContainer = document.getElementById("gov-list");
        const uniqueGovs = [];

        features.forEach(f => {
            const gov = f.attributes.Governorate;
            if (gov && !uniqueGovs.includes(gov)) {
                uniqueGovs.push(gov);
            }
        });

        uniqueGovs.sort();

        govListContainer.innerHTML = ""; // تصفية النص المؤقت

        uniqueGovs.forEach(gov => {
            const li = document.createElement("li");
            // تفعيلهم بالـ checked تلقائياً لتبدأ الخريطة بعرض كل شيء [1.1.1]
            li.innerHTML = `
                <label>
                    <input type="checkbox" class="gov-checkbox" value="${gov}" checked>
                    <span>${gov}</span>
                </label>
            `;
            govListContainer.appendChild(li);
        });

        // ربط حدث التغيير تفاعلياً بمجرد إنشاء المربعات البرمجية
        document.querySelectorAll(".gov-checkbox").forEach(cb => {
            cb.addEventListener("change", applyCrossFilters);
        });
    }

    // 🗺️ دالة بناء خيارات مستويات الخطورة كمربعات اختيار (Checkboxes) ديناميكياً
    function populateCategoryChecklist() {
        const catListContainer = document.getElementById("cat-list");
        const categories = ["Catastrophic", "Extreme", "Severe", "Moderate", "Low"];

        catListContainer.innerHTML = "";

        categories.forEach(cat => {
            const li = document.createElement("li");
            li.innerHTML = `
                <label>
                    <input type="checkbox" class="cat-checkbox" value="${cat}" checked>
                    <span>${cat}</span>
                </label>
            `;
            catListContainer.appendChild(li);
        });

        // ربط حدث التغيير تفاعلياً
        document.querySelectorAll(".cat-checkbox").forEach(cb => {
            cb.addEventListener("change", applyCrossFilters);
        });
    }

    // 📊 دالة الحساب الجغرافي وبناء جدول الخطورة والسكان تفاعلياً [3]
    function calculateDynamicRiskStats(features) {
        let stats = {
            "Catastrophic": { count: 0, pop: 0, label: "كارثية (Catastrophic)", class: "risk-catastrophic" },
            "Extreme": { count: 0, pop: 0, label: "قصوى (Extreme)", class: "risk-extreme" },
            "Severe": { count: 0, pop: 0, label: "شديدة (Severe)", class: "risk-severe" },
            "Moderate": { count: 0, pop: 0, label: "متوسطة (Moderate)", class: "risk-moderate" },
            "Low": { count: 0, pop: 0, label: "منخفضة (Low)", class: "risk-low" }
        };

        features.forEach(f => {
            const props = f.attributes;
            let cat = props.Category || "Low"; // التصنيف
            let pop = parseInt(props.Total_IDPs) || 0; // السكان

            if (cat.toLowerCase() === "catastrophic") cat = "Catastrophic";
            if (cat.toLowerCase() === "extreme") cat = "Extreme";
            if (cat.toLowerCase() === "severe" || cat.toLowerCase() === "high") cat = "Severe";
            if (cat.toLowerCase() === "moderate") cat = "Moderate";
            if (cat.toLowerCase() === "low" || cat.toLowerCase() === "minor") cat = "Low";

            if (stats[cat]) {
                stats[cat].count++;
                stats[cat].pop += pop;
            }
        });

        const tableBody = document.getElementById('stats-table-body');
        tableBody.innerHTML = ""; 

        for (let key in stats) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="${stats[key].class}">${stats[key].label}</td>
                <td><b>${stats[key].count}</b></td>
                <td><b>${stats[key].pop.toLocaleString()}</b></td>
            `;
            tableBody.appendChild(row);
        }
    }

    // 🎛️ دالة تطبيق الفلترة المتقاطعة للخيارات المتعددة بالـ Checkboxes وجاذبية الكاميرا GoTo [1.1.1, 3]
    function applyCrossFilters() {
        // جمع كل القيم المفعلة من مربعات صح المحافظات والخطورة [1.1.1, 3]
        const checkedGovs = Array.from(document.querySelectorAll(".gov-checkbox:checked")).map(cb => cb.value);
        const checkedCats = Array.from(document.querySelectorAll(".cat-checkbox:checked")).map(cb => cb.value);

        // 1. بناء التعبير الجغرافي الـ SQL المتقاطع بمرونة فائقة للمتعدد [1.1.1, 3]
        let sql = [];
        
        if (checkedGovs.length > 0) {
            const formattedGovs = checkedGovs.map(g => `'${g}'`).join(",");
            sql.push(`Governorate IN (${formattedGovs})`);
        } else {
            sql.push("1=0"); // إذا تم إلغاء كل المحافظات، لا يعرض شيئاً
        }
        
        if (checkedCats.length > 0) {
            const formattedCats = checkedCats.map(c => `'${c}'`).join(",");
            sql.push(`Category IN (${formattedCats})`);
        } else {
            sql.push("1=0"); // إذا تم إلغاء الخطورة بالكامل، لا يعرض شيئاً
        }

        const finalExpr = sql.length > 0 ? sql.join(" AND ") : null;
        idpSitesLayer.definitionExpression = finalExpr; // تصفية الخريطة فوراً [3]

        // 2. تحديث جدول الإحصائيات حياً للمخيمات المعروضة فقط [3]
        const filteredFeatures = loadedPopulatedFeatures.filter(f => {
            const featureGov = f.attributes.Governorate;
            const featureCat = f.attributes.Category ? f.attributes.Category.toLowerCase() : "";
            
            const matchGov = checkedGovs.includes(featureGov);
            const matchCat = checkedCats.some(c => c.toLowerCase() === featureCat);
            
            return matchGov && matchCat;
        });
        calculateDynamicRiskStats(filteredFeatures);

        // 3. 🚨 التحليق والتركيز الجغرافي التلقائي (الزووم الذكي "takes us to it" كاميرا الـ GoTo) [1]
        idpSitesLayer.queryExtent().then(function(response) {
            // شرط الحماية الفنية: الكاميرا لن تطير أو تتحرك أبداً إذا لم يكن هناك نتائج بالفلترة! [1]
            if (response.extent && response.count > 0) {
                view.goTo(response.extent.expand(1.25), { duration: 1000 }); 
            }
        });
    }

    // دالة إيقاف وإلغاء أداة التقاط الإحداثيات الـ GPS لتفادي التداخل البرمجي
    function deactivateCoordTool() {
        isCoordToolActive = false;
        const getCoordsBtn = document.getElementById("get-coordinates-btn");
        getCoordsBtn.classList.remove("active");
        getCoordsBtn.innerText = "📍 معرفة الإحداثيات";
        view.cursor = "default";
        if (clickListenerHandle) {
            clickListenerHandle.remove();
            clickListenerHandle = null;
        }
    }

    // دالة تفعيل الأزرار والـ Toggles لجميع الطبقات
    function setupInteractivity() {
        // ربط أزرار التحكم بالطبقات الأساسية والإدارية والجديدة
        document.getElementById('toggle-camps').addEventListener('change', function(e) {
            idpSitesLayer.visible = e.target.checked;
        });

        document.getElementById('toggle-water').addEventListener('change', function(e) {
            waterLineLayer.visible = e.target.checked;
        });

        document.getElementById('toggle-admin1').addEventListener('change', function(e) {
            admin1Layer.visible = e.target.checked;
        });

        // ربط زر الـ TIF الجديد لتفعيله وإلغائه تفاعلياً بلمسة واحدة! (🏥 جديد) [1]
        document.getElementById('toggle-damage').addEventListener('change', function(e) {
            if (damageTiffLayer) {
                damageTiffLayer.visible = e.target.checked;
            }
        });

        // 📐 ربط أزرار أداة القياس الجغرافي تفاعلياً [1]
        document.getElementById("measure-distance-btn").addEventListener("click", () => {
            deactivateCoordTool(); // إطفاء أداة الإحداثيات لمنع التداخل [1]
            measurementWidget.activeTool = "distance"; // تفعيل أداة قياس المسافات [1]
        });

        document.getElementById("measure-area-btn").addEventListener("click", () => {
            deactivateCoordTool(); // إطفاء أداة الإحداثيات لمنع التداخل [1]
            measurementWidget.activeTool = "area"; // تفعيل أداة قياس المساحات [1]
        });

        // 📍 ربط أداة التقاط الإحداثيات الـ GPS الخضراء [1, 3]
        const getCoordsBtn = document.getElementById("get-coordinates-btn");
        getCoordsBtn.addEventListener("click", function() {
            isCoordToolActive = !isCoordToolActive;
            
            if (isCoordToolActive) {
                // إطفاء أدوات القياس الأخرى لتفادي التداخل البرمجي [1]
                measurementWidget.clear();
                getCoordsBtn.classList.add("active");
                getCoordsBtn.innerText = "📍 انقر على الخريطة لالتقاط الإحداثيات";
                view.cursor = "crosshair"; // تغيير المؤشر لعلامة تصويب دقيقة [1]
                
                // الاستماع لنقرات المستخدم على الخريطة [3]
                clickListenerHandle = view.on("click", function(event) {
                    const lat = event.mapPoint.latitude.toFixed(5);
                    const lon = event.mapPoint.longitude.toFixed(5);
                    
                    view.openPopup({
                        title: "الإحداثيات الجغرافية الملتقطة (WGS 84):",
                        location: event.mapPoint,
                        content: `
                            <table class="esri-widget__table" style="width: 100%; border-collapse: collapse; font-family: Segoe UI, sans-serif; font-size: 13px;">
                                <tr style="background-color: #f7fafc;"><td style="padding: 8px; font-weight: bold; width: 45%;">خط العرض (Latitude):</td><td style="padding: 8px; font-weight: bold; color: #dc2626;">${lat}</td></tr>
                                <tr><td style="padding: 8px; font-weight: bold;">خط الطول (Longitude):</td><td style="padding: 8px; font-weight: bold; color: #2563eb;">${lon}</td></tr>
                            </table>
                        `
                    });
                });
            } else {
                deactivateCoordTool();
            }
        });

        // زر تصفية ومسح جميع أدوات القياس والإحداثيات معاً
        document.getElementById("clear-measure-btn").addEventListener("click", () => {
            deactivateCoordTool(); // إيقاف أداة الإحداثيات [1]
            measurementWidget.clear(); // مسح خطوط القياس والمساحة [1]
            view.closePopup(); // إغلاق أي منبثقة مفتوحة
        });

        // 🚨 ربط أزرار الـ Select All و الـ Reset للمحافظات تفاعلياً بطلبك الجديد! [1.1.3, 3]
        document.getElementById("gov-select-all").addEventListener("click", function() {
            document.querySelectorAll(".gov-checkbox").forEach(cb => cb.checked = true);
            applyCrossFilters();
        });

        document.getElementById("gov-reset").addEventListener("click", function() {
            document.querySelectorAll(".gov-checkbox").forEach(cb => cb.checked = false);
            applyCrossFilters();
        });

        // 🚨 ربط أزرار الـ Select All و الـ Reset لمستويات الخطورة تفاعلياً بطلبك الجديد! [1.1.3, 3]
        document.getElementById("cat-select-all").addEventListener("click", function() {
            document.querySelectorAll(".cat-checkbox").forEach(cb => cb.checked = true);
            applyCrossFilters();
        });

        document.getElementById("cat-reset").addEventListener("click", function() {
            document.querySelectorAll(".cat-checkbox").forEach(cb => cb.checked = false);
            applyCrossFilters();
        });

        // 🚨 تفعيل البحث الفوري المباشر للمحافظات جغرافياً! (بمجرد الكتابة يتم تصفية الأسماء تفاعلياً) [3]
        document.getElementById("gov-search").addEventListener("input", function(e) {
            const searchText = e.target.value.toLowerCase();
            document.querySelectorAll("#gov-list li").forEach(li => {
                const text = li.textContent.toLowerCase();
                if (text.includes(searchText)) {
                    li.style.display = ""; // تظهره إذا طابق البحث
                } else {
                    li.style.display = "none"; // تخفيه إذا لم يطابق
                }
            });
        });

        // 🚨 تفعيل البحث الفوري لمستويات الخطورة! [3]
        document.getElementById("cat-search").addEventListener("input", function(e) {
            const searchText = e.target.value.toLowerCase();
            document.querySelectorAll("#cat-list li").forEach(li => {
                const text = li.textContent.toLowerCase();
                if (text.includes(searchText)) {
                    li.style.display = "";
                } else {
                    li.style.display = "none";
                }
            });
        });
    }

    // 🚨 تفعيل طي وإخفاء اللوحة الجانبية اليمنى بنعومة فائقة مع ثبات السهم تماماً على حافة الشاشة! [1]
    const rightPanel = document.getElementById('right-panel');
    const panelToggle = document.getElementById('panel-toggle');
    panelToggle.addEventListener('click', function() {
        rightPanel.classList.toggle('collapsed');
        if (rightPanel.classList.contains('collapsed')) {
            panelToggle.innerText = '❮'; // السهم يشير لليسار لإعادة الفتح
        } else {
            panelToggle.innerText = '❯'; // السهم يشير لليمين للإغلاق والطي
        }
    });

    // تفعيل وإغلاق النافذة الترحيبية وحفظ خيار عدم الإظهار مجدداً عند التشغيل
    const modal = document.getElementById('intro-modal');
    const closeModalBtn = document.getElementById('close-modal');
    const hideOnStartupCheckbox = document.getElementById('hide-on-startup');

    if (localStorage.getItem('hideSyriaFloodIntro') === 'true') {
        modal.style.display = 'none'; 
    }

    closeModalBtn.addEventListener('click', function() {
        modal.style.display = 'none';
        if (hideOnStartupCheckbox.checked) {
            localStorage.setItem('hideSyriaFloodIntro', 'true');
        }
    });

    window.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.style.display = 'none';
            if (hideOnStartupCheckbox.checked) {
                localStorage.setItem('hideSyriaFloodIntro', 'true');
            }
        }
    });

});
